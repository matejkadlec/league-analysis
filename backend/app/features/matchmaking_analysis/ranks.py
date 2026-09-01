"""Pure rank arithmetic and duo classification for matchmaking analysis.

No session, no client, no service state -- everything here is testable
without constructing a `MatchmakingAnalysisService`.
"""

from collections import Counter
from dataclasses import dataclass
from statistics import fmean
from typing import TypedDict, cast

from app.core.enums import UNRANKED, Division, LobbyTier, Tier, lobby_tier_values

_LOBBY_TIERS = set(lobby_tier_values())


def _lobby_tier(value: str) -> LobbyTier:
    """Pass a known lobby tier through; anything else is the unranked bucket."""
    return cast(LobbyTier, value) if value in _LOBBY_TIERS else UNRANKED


# LP-equivalent scale: each tier spans 400 points (4 divisions x 100 LP), and
# divisionless MASTER+ continues it from DIAMOND I 100 LP == MASTER 0 == 2800.
_TIER_INDEX = {tier.value: index for index, tier in enumerate(Tier)}
_DIVISION_OFFSET = {
    Division.IV.value: 0,
    Division.III.value: 100,
    Division.II.value: 200,
    Division.I.value: 300,
}
MASTER_FLOOR = _TIER_INDEX[Tier.MASTER.value] * 400

# The frontend formatter `rankValueToDisplay` mirrors this scale; the shared
# fixtures in `test_matchmaking_ranks.py` / `rank-display.test.ts` guard drift.


def rank_value(tier: str, rank: str | None, league_points: int) -> int:
    """Map a league entry to one comparable LP-equivalent scalar."""
    try:
        tier_index = _TIER_INDEX[tier]
    except KeyError as error:
        raise ValueError(f"Unknown tier: {tier}") from error
    if tier_index * 400 >= MASTER_FLOOR:
        return MASTER_FLOOR + league_points
    if not rank:
        return tier_index * 400 + league_points
    try:
        return tier_index * 400 + _DIVISION_OFFSET[rank] + league_points
    except KeyError as error:
        raise ValueError(f"Unknown division: {rank}") from error


@dataclass(frozen=True)
class RankSummary:
    """Per-side rank aggregates over the unique players of one run."""

    ally_avg_rank_value: float | None
    enemy_avg_rank_value: float | None
    ally_tier_counts: dict[LobbyTier, int]
    enemy_tier_counts: dict[LobbyTier, int]


def _side_summary(
    puuids: set[str],
    tiers: dict[str, str],
    values: dict[str, int | None],
) -> tuple[float | None, dict[LobbyTier, int]]:
    counts: dict[LobbyTier, int] = dict(
        Counter(_lobby_tier(tiers.get(puuid, UNRANKED)) for puuid in puuids)
    )
    ranked = [value for puuid in puuids if (value := values.get(puuid)) is not None]
    average = round(fmean(ranked), 1) if ranked else None
    return average, counts


def summarize_ranks(
    ally_puuids: set[str],
    enemy_puuids: set[str],
    tiers: dict[str, str],
    values: dict[str, int | None],
) -> RankSummary:
    """Aggregate cached per-player ranks into per-side averages and buckets.

    A player seen on both sides counts once per side, and unranked players are
    bucketed rather than averaged in as 0.
    """
    ally_avg, ally_counts = _side_summary(ally_puuids, tiers, values)
    enemy_avg, enemy_counts = _side_summary(enemy_puuids, tiers, values)
    return RankSummary(
        ally_avg_rank_value=ally_avg,
        enemy_avg_rank_value=enemy_avg,
        ally_tier_counts=ally_counts,
        enemy_tier_counts=enemy_counts,
    )


class PlayerRankJSON(TypedDict):
    """One participant's rank at run time, as stored in results JSONB."""

    tier: LobbyTier
    value: int | None


def player_rank_map(
    puuids: set[str],
    tiers: dict[str, str],
    values: dict[str, int | None],
) -> dict[str, PlayerRankJSON]:
    """Per-player tier and LP-equivalent value, for client-side scope slicing."""
    return {
        puuid: {
            "tier": _lobby_tier(tiers.get(puuid, UNRANKED)),
            "value": values.get(puuid),
        }
        for puuid in puuids
    }


def duo_partner_puuids(
    spine_allies: list[tuple[str, list[str]]],
    *,
    analyzed_puuid: str,
) -> set[str]:
    """Non-analyzed allies recurring in >= 2 spine matches: the likely duo.

    Ignores ``analyzed_puuid`` (they appear in every match). ponytail: no party data.
    """
    appearances = Counter(
        puuid
        for _match_id, allies in spine_allies
        for puuid in set(allies)
        if puuid != analyzed_puuid
    )
    return {puuid for puuid, count in appearances.items() if count >= 2}


def classify_duo_matches(
    spine_allies: list[tuple[str, list[str]]],
    *,
    analyzed_puuid: str,
) -> dict[str, bool]:
    """Flag spine matches in which a likely duo partner played."""
    partners = duo_partner_puuids(spine_allies, analyzed_puuid=analyzed_puuid)
    return {
        match_id: not partners.isdisjoint(allies) for match_id, allies in spine_allies
    }
