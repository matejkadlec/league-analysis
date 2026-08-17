"""Conservative persisted LP attribution for ranked Solo/Duo matches."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.players.leagues import PlayerLeague

from .models import Match
from .participants import MatchParticipant

RANKED_SOLO_QUEUE_ID = 420
LP_SOURCE_OBSERVED = "riot_league_observation"
LP_SOURCE_REMAKE = "riot_match_remake"
LP_SOURCE_UNAVAILABLE = "unavailable"


@dataclass(frozen=True)
class LPAttribution:
    """One persisted LP result and its stable provenance reason."""

    change: int | None
    source: str
    reason: str


def league_snapshot_datetime(snapshot: PlayerLeague) -> datetime:
    """Normalize stored league timestamps to an aware UTC datetime."""
    value = snapshot.created_at
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def initialize_participant_lp(
    participant: MatchParticipant,
    *,
    queue_id: int,
    remake: bool,
) -> None:
    """Initialize ranked rows without overwriting an existing observation."""
    if queue_id != RANKED_SOLO_QUEUE_ID or participant.lp_change_source is not None:
        return
    if remake:
        participant.lp_change = 0
        participant.lp_change_source = LP_SOURCE_REMAKE
        participant.lp_change_reason = "riot_eligible_for_progression_false"
        return
    participant.lp_change = None
    participant.lp_change_source = LP_SOURCE_UNAVAILABLE
    participant.lp_change_reason = "league_observation_pending"


def _counter_transition_matches(
    participant: MatchParticipant,
    before: PlayerLeague,
    after: PlayerLeague,
) -> bool:
    wins_delta = after.wins - before.wins
    losses_delta = after.losses - before.losses
    if participant.win:
        return wins_delta == 1 and losses_delta == 0
    return wins_delta == 0 and losses_delta == 1


def _precondition_attribution(
    participant: MatchParticipant,
    match: Match,
    before: PlayerLeague | None,
    after: PlayerLeague | None,
    progression_match_count: int,
) -> LPAttribution | None:
    if match.queue_id != RANKED_SOLO_QUEUE_ID:
        return LPAttribution(None, LP_SOURCE_UNAVAILABLE, "not_ranked_solo")
    if participant.remake:
        return LPAttribution(
            0,
            LP_SOURCE_REMAKE,
            "riot_eligible_for_progression_false",
        )
    if before is None:
        return LPAttribution(None, LP_SOURCE_UNAVAILABLE, "missing_before_snapshot")
    if after is None:
        return LPAttribution(None, LP_SOURCE_UNAVAILABLE, "missing_after_snapshot")
    if progression_match_count != 1:
        return LPAttribution(
            None,
            LP_SOURCE_UNAVAILABLE,
            "ambiguous_progression_batch",
        )
    return None


def _result_direction_matches(participant: MatchParticipant, change: int) -> bool:
    if participant.win:
        return change > 0
    return change < 0


def attribute_lp_change(
    participant: MatchParticipant,
    match: Match,
    before: PlayerLeague | None,
    after: PlayerLeague | None,
    *,
    progression_match_count: int,
) -> LPAttribution:
    """Attribute LP only when Riot snapshots prove one exact match transition."""
    precondition = _precondition_attribution(
        participant,
        match,
        before,
        after,
        progression_match_count,
    )
    if precondition is not None:
        return precondition
    assert before is not None and after is not None
    assert match.game_end_timestamp is not None

    match_end = datetime.fromtimestamp(
        match.game_end_timestamp / 1000,
        tz=UTC,
    )
    if not (
        league_snapshot_datetime(before) < match_end < league_snapshot_datetime(after)
    ):
        return LPAttribution(None, LP_SOURCE_UNAVAILABLE, "outside_snapshot_window")
    if not _counter_transition_matches(participant, before, after):
        return LPAttribution(None, LP_SOURCE_UNAVAILABLE, "counter_mismatch")
    if before.tier != after.tier or before.rank != after.rank:
        return LPAttribution(None, LP_SOURCE_UNAVAILABLE, "rank_boundary")

    change = after.league_points - before.league_points
    if not _result_direction_matches(participant, change):
        return LPAttribution(None, LP_SOURCE_UNAVAILABLE, "invalid_result_direction")
    return LPAttribution(
        change,
        LP_SOURCE_OBSERVED,
        "single_match_counter_transition",
    )


async def persist_match_lp_observations(
    session: AsyncSession,
    puuid: str,
    match_ids: Iterable[str],
    before: PlayerLeague | None,
    after: PlayerLeague | None,
) -> int:
    """Persist idempotent LP observations for one Match Fetcher player batch."""
    unique_ids = set(match_ids)
    if not unique_ids:
        return 0
    result = await session.execute(
        select(MatchParticipant, Match)
        .join(Match, Match.match_id == MatchParticipant.match_id)
        .where(
            MatchParticipant.puuid == puuid,
            MatchParticipant.match_id.in_(unique_ids),
            Match.queue_id == RANKED_SOLO_QUEUE_ID,
        )
        .order_by(Match.game_end_timestamp, Match.match_id)
    )
    rows = list(result.all())
    progression_match_count = sum(
        1 for participant, _match in rows if not participant.remake
    )
    before_at = league_snapshot_datetime(before) if before is not None else None
    after_at = league_snapshot_datetime(after) if after is not None else None
    changed = 0
    for participant, match in rows:
        attribution = attribute_lp_change(
            participant,
            match,
            before,
            after,
            progression_match_count=progression_match_count,
        )
        new_values = (
            attribution.change,
            attribution.source,
            attribution.reason,
            before_at,
            after_at,
        )
        old_values = (
            participant.lp_change,
            participant.lp_change_source,
            participant.lp_change_reason,
            participant.lp_before_snapshot_at,
            participant.lp_after_snapshot_at,
        )
        if old_values == new_values:
            continue
        participant.lp_change = attribution.change
        participant.lp_change_source = attribution.source
        participant.lp_change_reason = attribution.reason
        participant.lp_before_snapshot_at = before_at
        participant.lp_after_snapshot_at = after_at
        changed += 1
    return changed
