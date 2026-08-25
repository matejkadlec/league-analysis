"""Match timeline model and objective-focused transformation helpers."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime
from typing import Any, Protocol

import structlog
from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    delete,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from app.core.models import Base, created_at_column, updated_at_column
from app.core.riot_api.models import (
    MatchTimelineDTO,
    MatchTimelineEventDTO,
    MatchTimelineFrameDTO,
)

logger = structlog.get_logger(__name__)


class TimelineParticipant(Protocol):
    """The participant fields timeline aggregation reads."""

    @property
    def participant_id(self) -> int: ...

    @property
    def team_id(self) -> int: ...

    @property
    def puuid(self) -> str: ...


class TimelineMatchInfo(Protocol):
    """The match-info fields timeline aggregation reads."""

    @property
    def game_version(self) -> str: ...

    @property
    def participants(self) -> Sequence[TimelineParticipant]: ...


class TimelineMatchMetadata(Protocol):
    """The match-metadata fields timeline aggregation reads."""

    @property
    def match_id(self) -> str: ...


class TimelineMatch(Protocol):
    """A match seen through the small window timeline aggregation needs.

    Both a full `MatchDTO` off the wire and the synthetic DTO rebuilt from
    stored participants (`build_synthetic_match_dto`) are accepted here, so the
    parameter names the members actually read rather than either concrete type.
    """

    @property
    def metadata(self) -> TimelineMatchMetadata: ...

    @property
    def info(self) -> TimelineMatchInfo: ...


VALID_TEAM_IDS = {100, 200}
OBJECTIVE_KINDS = {
    "turret",
    "inhibitor",
    "dragon",
    "rift_herald",
    "baron",
    "voidgrub",
    "atakhan",
}

_BUILDING_SPECS: dict[str, tuple[str, str, bool]] = {
    "TOWER_BUILDING": ("turret", "team_turrets_destroyed", True),
    "INHIBITOR_BUILDING": ("inhibitor", "team_inhibitors_destroyed", False),
}

_MONSTER_SPECS: dict[str, tuple[str, str]] = {
    "DRAGON": ("dragon", "team_dragons_slain"),
    "RIFTHERALD": ("rift_herald", "team_rift_heralds_slain"),
    "BARON_NASHOR": ("baron", "team_barons_slain"),
    "HORDE": ("voidgrub", "team_voidgrubs_slain"),
}


class MatchTimeline(Base):
    """Objective-focused timeline aggregates per participant."""

    __tablename__ = "match_timelines"
    __table_args__ = (
        UniqueConstraint(
            "match_id",
            "participant_id",
            name="uq_match_timelines_match_participant",
        ),
        # Bare names: the `ck` naming convention is
        # `ck_%(table_name)s_%(constraint_name)s`, so it prefixes these itself.
        # Spelling the prefix here too yields `ck_match_timelines_ck_match_...`.
        CheckConstraint(
            "participant_id BETWEEN 1 AND 10",
            name="participant_id_range",
        ),
        CheckConstraint("team_id IN (100, 200)", name="team_id_valid"),
        {
            "schema": "core",
            "comment": (
                "Objective-focused match timeline aggregates.\n"
                "Stores one row per participant with objective takedowns and "
                "team objective totals."
            ),
        },
    )

    # Composite PK requested by product requirements.
    match_id: Mapped[str] = mapped_column(
        String(20),
        ForeignKey("core.matches.match_id", ondelete="CASCADE"),
        primary_key=True,
        nullable=False,
    )
    puuid: Mapped[str] = mapped_column(
        String(78),
        ForeignKey("core.players.puuid", ondelete="CASCADE"),
        primary_key=True,
        nullable=False,
    )

    # Participant identity and match-level timeline shape.
    participant_id: Mapped[int] = mapped_column(Integer, nullable=False)
    team_id: Mapped[int] = mapped_column(Integer, nullable=False)

    # Team totals are repeated on each participant row for fast reads.
    team_turrets_destroyed: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )
    team_inhibitors_destroyed: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )
    team_dragons_slain: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    team_rift_heralds_slain: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )
    team_barons_slain: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    team_voidgrubs_slain: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )
    team_atakhan_slain: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    team_other_epic_monsters_slain: Mapped[dict[str, int]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )

    # The comment is the decoder for the short keys, so it belongs on the column
    # rather than only here -- it is the one place the encoding is written down
    # next to the data.
    objective_events: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB,
        nullable=False,
        default=list,
        server_default=text("'[]'::jsonb"),
        comment=(
            "Compact objective event log.\n"
            "Each object uses short keys: t=timestamp, o=objective, "
            "r=role(K/A), optional l=lane, s=subtype, m=monsterType.\n"
            "This is the per-participant record: twenty-two counter columns "
            "used to hold sums over exactly these entries and nothing read "
            "any of them (revision 0028)."
        ),
    )

    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()


Index("idx_match_timelines_puuid", MatchTimeline.puuid)
Index("idx_match_timelines_match_team", MatchTimeline.match_id, MatchTimeline.team_id)


def _normalize_text(value: str | None) -> str | None:
    """Normalize an optional Riot text field to uppercase non-empty text.

    The DTO types these fields but does not constrain their contents, so the
    case-folding and empty-string handling here stay load-bearing.
    """
    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    return cleaned.upper()


def _increment_counter(counter: dict[str, int], key: str) -> None:
    """Increment a string-keyed integer counter."""
    counter[key] = counter.get(key, 0) + 1


def _uses_historical_atakhan_contract(game_version: str) -> bool:
    """Whether the match predates the 2026 objective-set change."""
    try:
        return int(game_version.split(".", 1)[0]) < 16
    except AttributeError, TypeError, ValueError:
        logger.debug(
            "timeline_version_parse_failed",
            game_version=game_version,
        )
        return False


def _collect_involved_participants(
    event: MatchTimelineEventDTO,
    valid_participant_ids: set[int],
) -> tuple[int | None, list[int]]:
    """Extract unique participant IDs involved in an objective event."""
    killer_raw = event.killer_id
    killer_id = killer_raw if killer_raw in valid_participant_ids else None

    involved: list[int] = []
    seen: set[int] = set()

    if killer_id is not None:
        involved.append(killer_id)
        seen.add(killer_id)

    for assist_id in event.assisting_participant_ids or []:
        if assist_id not in valid_participant_ids:
            continue
        if assist_id in seen:
            continue
        involved.append(assist_id)
        seen.add(assist_id)

    return killer_id, involved


def _determine_killer_team_id(
    event: MatchTimelineEventDTO,
    killer_id: int | None,
    participant_team_by_id: dict[int, int],
) -> int | None:
    """Resolve killer team from event payload and participant mapping."""
    if killer_id is not None:
        killer_team = participant_team_by_id.get(killer_id)
        if killer_team in VALID_TEAM_IDS:
            return killer_team

    explicit_team = event.killer_team_id
    if explicit_team in VALID_TEAM_IDS:
        return explicit_team

    if event.type == "BUILDING_KILL":
        destroyed_team = event.team_id
        if destroyed_team == 100:
            return 200
        if destroyed_team == 200:
            return 100

    return None


def _append_compact_objective_event(
    row: dict[str, Any],
    timestamp: int,
    objective: str,
    role: str,
    lane: str | None = None,
    subtype: str | None = None,
    monster_type: str | None = None,
) -> None:
    """Append a compact objective event entry to row JSON."""
    entry: dict[str, Any] = {"t": timestamp, "o": objective, "r": role}
    if lane:
        entry["l"] = lane
    if subtype:
        entry["s"] = subtype
    if monster_type:
        entry["m"] = monster_type

    row["objective_events"].append(entry)


def _new_team_total_bucket() -> dict[str, Any]:
    """Create an empty team-level objective totals bucket.

    The one place the team-total key set is written down. `_new_participant_row`
    splats it and `_apply_team_totals_to_row` iterates it, so a new objective is
    added here and nowhere else. It used to be spelled three times, and the
    third copy had already drifted -- it omitted
    `team_other_epic_monsters_slain`, which is why that one field needed its own
    hand-written copy line.
    """
    return {
        "team_turrets_destroyed": 0,
        "team_inhibitors_destroyed": 0,
        "team_dragons_slain": 0,
        "team_rift_heralds_slain": 0,
        "team_barons_slain": 0,
        "team_voidgrubs_slain": 0,
        "team_atakhan_slain": 0,
        "team_other_epic_monsters_slain": {},
    }


def _new_team_totals() -> dict[int, dict[str, Any]]:
    """Create empty team totals for both sides."""
    return {100: _new_team_total_bucket(), 200: _new_team_total_bucket()}


def _new_participant_row(
    match_id: str,
    puuid: str,
    participant_id: int,
    team_id: int,
) -> dict[str, Any]:
    """Create an empty participant timeline aggregate row."""
    return {
        "match_id": match_id,
        "puuid": puuid,
        "participant_id": participant_id,
        "team_id": team_id,
        **_new_team_total_bucket(),
        "objective_events": [],
    }


def _collect_participant_rows(
    match_dto: TimelineMatch,
) -> tuple[dict[int, int], dict[int, dict[str, Any]]]:
    """Index valid participants and their empty timeline rows."""
    participant_team_by_id: dict[int, int] = {}
    rows_by_participant_id: dict[int, dict[str, Any]] = {}
    match_id = match_dto.metadata.match_id

    for participant in match_dto.info.participants:
        participant_id = participant.participant_id
        team_id = participant.team_id
        if team_id not in VALID_TEAM_IDS:
            continue
        participant_team_by_id[participant_id] = team_id
        rows_by_participant_id[participant_id] = _new_participant_row(
            match_id=match_id,
            puuid=participant.puuid,
            participant_id=participant_id,
            team_id=team_id,
        )

    return participant_team_by_id, rows_by_participant_id


def _event_role(killer_id: int | None, participant_id: int) -> str:
    """Return compact killer/assist role for an involved participant."""
    if killer_id is not None and participant_id == killer_id:
        return "K"
    return "A"


def _iter_involved_rows(
    involved: list[int],
    rows_by_participant_id: dict[int, dict[str, Any]],
) -> list[tuple[int, dict[str, Any]]]:
    """Return involved participant IDs that have an aggregate row."""
    rows: list[tuple[int, dict[str, Any]]] = []
    for participant_id in involved:
        row = rows_by_participant_id.get(participant_id)
        if row is None:
            continue
        rows.append((participant_id, row))
    return rows


def _resolve_building_objective(
    building_type: str | None,
    tower_type: str | None,
) -> tuple[str | None, str | None, str | None]:
    """Map a building kill to its objective, team-total field, and subtype."""
    spec = _BUILDING_SPECS.get(building_type) if building_type is not None else None
    if spec is None:
        return None, None, None
    objective, team_field, use_tower_subtype = spec
    return objective, team_field, tower_type if use_tower_subtype else None


def _resolve_monster_objective(
    monster_type: str,
    historical_atakhan: bool,
) -> tuple[str | None, str | None]:
    """Map an elite monster kill to objective and team-total fields."""
    spec = _MONSTER_SPECS.get(monster_type)
    if spec is not None:
        return spec
    if monster_type == "ATAKHAN" and historical_atakhan:
        return "atakhan", "team_atakhan_slain"
    return None, None


def _increment_known_team_total(
    team_totals: dict[int, dict[str, Any]],
    killer_team_id: int | None,
    team_total_field: str | None,
) -> None:
    """Increment a known team objective counter when the killer team is valid."""
    if team_total_field is None or killer_team_id not in VALID_TEAM_IDS:
        return
    team_totals[killer_team_id][team_total_field] += 1


def _credit_team_monster(
    team_totals: dict[int, dict[str, Any]],
    killer_team_id: int | None,
    objective: str | None,
    team_total_field: str | None,
    monster_type: str,
) -> None:
    """Credit a team-level epic-monster kill or retain an unknown type."""
    if killer_team_id not in VALID_TEAM_IDS:
        return
    if objective is not None and team_total_field is not None:
        team_totals[killer_team_id][team_total_field] += 1
        return
    _increment_counter(
        team_totals[killer_team_id]["team_other_epic_monsters_slain"],
        monster_type,
    )


def _record_monster_takedown(
    row: dict[str, Any],
    objective: str | None,
    role: str,
    timestamp: int,
    monster_type: str,
    monster_subtype: str | None,
) -> None:
    """Record a monster takedown, retaining the type when it is unrecognized.

    A monster this codebase does not know about is still logged, under
    `other_epic_monster` and carrying `m` -- that is what let ATAKHAN appear in
    current-patch matches before it was an objective here.
    """
    known = objective if objective in OBJECTIVE_KINDS else None
    _append_compact_objective_event(
        row=row,
        timestamp=timestamp,
        objective=known or "other_epic_monster",
        role=role,
        subtype=monster_subtype,
        monster_type=None if known else monster_type,
    )


def _record_unknown_building(
    match_id: str,
    building_type: str | None,
    tower_type: str | None,
    lane_type: str | None,
    timestamp: int,
    killer_id: int | None,
    involved: list[int],
    rows_by_participant_id: dict[int, dict[str, Any]],
) -> None:
    """Log and retain an unrecognized building objective for involved players."""
    logger.warning(
        "Unknown Riot timeline building objective",
        match_id=match_id,
        building_type=building_type,
        tower_type=tower_type,
        lane_type=lane_type,
        timestamp=timestamp,
    )
    for participant_id, row in _iter_involved_rows(involved, rows_by_participant_id):
        _append_compact_objective_event(
            row=row,
            timestamp=timestamp,
            objective="other_building",
            role=_event_role(killer_id, participant_id),
            lane=lane_type,
            subtype=building_type,
            monster_type=tower_type,
        )


def _apply_building_kill(
    event: MatchTimelineEventDTO,
    match_id: str,
    killer_id: int | None,
    involved: list[int],
    killer_team_id: int | None,
    rows_by_participant_id: dict[int, dict[str, Any]],
    team_totals: dict[int, dict[str, Any]],
) -> None:
    """Apply a BUILDING_KILL event to team totals and participant rows."""
    building_type = _normalize_text(event.building_type)
    lane_type = _normalize_text(event.lane_type)
    tower_type = _normalize_text(event.tower_type)
    timestamp = event.timestamp
    objective, team_total_field, subtype = _resolve_building_objective(
        building_type, tower_type
    )

    if objective is None:
        _record_unknown_building(
            match_id,
            building_type,
            tower_type,
            lane_type,
            timestamp,
            killer_id,
            involved,
            rows_by_participant_id,
        )
        return

    _increment_known_team_total(team_totals, killer_team_id, team_total_field)
    for participant_id, row in _iter_involved_rows(involved, rows_by_participant_id):
        _append_compact_objective_event(
            row=row,
            timestamp=timestamp,
            objective=objective,
            role=_event_role(killer_id, participant_id),
            lane=lane_type,
            subtype=subtype,
        )


def _apply_elite_monster_kill(
    event: MatchTimelineEventDTO,
    match_id: str,
    game_version: str,
    historical_atakhan: bool,
    killer_id: int | None,
    involved: list[int],
    killer_team_id: int | None,
    rows_by_participant_id: dict[int, dict[str, Any]],
    team_totals: dict[int, dict[str, Any]],
) -> None:
    """Apply an ELITE_MONSTER_KILL event to team totals and participant rows."""
    monster_type = _normalize_text(event.monster_type)
    monster_subtype = _normalize_text(event.monster_sub_type)
    timestamp = event.timestamp
    if monster_type is None:
        return

    objective, team_total_field = _resolve_monster_objective(
        monster_type, historical_atakhan
    )
    if objective is None:
        logger.warning(
            "Unknown Riot timeline epic monster objective",
            match_id=match_id,
            game_version=game_version,
            monster_type=monster_type,
            monster_subtype=monster_subtype,
            timestamp=timestamp,
        )

    _credit_team_monster(
        team_totals,
        killer_team_id,
        objective,
        team_total_field,
        monster_type,
    )
    for participant_id, row in _iter_involved_rows(involved, rows_by_participant_id):
        _record_monster_takedown(
            row,
            objective,
            _event_role(killer_id, participant_id),
            timestamp,
            monster_type,
            monster_subtype,
        )


def _process_timeline_event(
    event: MatchTimelineEventDTO,
    match_id: str,
    game_version: str,
    historical_atakhan: bool,
    valid_participant_ids: set[int],
    participant_team_by_id: dict[int, int],
    rows_by_participant_id: dict[int, dict[str, Any]],
    team_totals: dict[int, dict[str, Any]],
) -> None:
    """Dispatch one timeline event when it is an objective kill."""
    event_type = event.type
    if event_type not in {"BUILDING_KILL", "ELITE_MONSTER_KILL"}:
        return

    killer_id, involved = _collect_involved_participants(event, valid_participant_ids)
    killer_team_id = _determine_killer_team_id(event, killer_id, participant_team_by_id)
    if event_type == "BUILDING_KILL":
        _apply_building_kill(
            event,
            match_id,
            killer_id,
            involved,
            killer_team_id,
            rows_by_participant_id,
            team_totals,
        )
        return
    _apply_elite_monster_kill(
        event,
        match_id,
        game_version,
        historical_atakhan,
        killer_id,
        involved,
        killer_team_id,
        rows_by_participant_id,
        team_totals,
    )


def _process_timeline_frames(
    frames: Sequence[MatchTimelineFrameDTO],
    match_id: str,
    game_version: str,
    historical_atakhan: bool,
    participant_team_by_id: dict[int, int],
    rows_by_participant_id: dict[int, dict[str, Any]],
    team_totals: dict[int, dict[str, Any]],
) -> None:
    """Walk timeline frames and apply recognized objective events."""
    valid_participant_ids = set(rows_by_participant_id.keys())
    for frame in frames:
        for event in frame.events:
            _process_timeline_event(
                event,
                match_id,
                game_version,
                historical_atakhan,
                valid_participant_ids,
                participant_team_by_id,
                rows_by_participant_id,
                team_totals,
            )


def _apply_team_totals_to_row(
    row: dict[str, Any], totals: dict[str, Any] | None
) -> None:
    """Copy team totals onto a participant row when the team is known."""
    if totals is None:
        return
    # `dict(...)` on the mutable ones: the bucket is shared per team, so
    # aliasing it onto each row would let a later mutation leak across rows.
    for field, value in totals.items():
        row[field] = value.copy() if isinstance(value, dict) else value


def _finalize_timeline_rows(
    rows_by_participant_id: dict[int, dict[str, Any]],
    team_totals: dict[int, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Attach team totals and return rows ordered by participant ID."""
    rows: list[dict[str, Any]] = []
    for participant_id in sorted(rows_by_participant_id.keys()):
        row = rows_by_participant_id[participant_id]
        _apply_team_totals_to_row(row, team_totals.get(row["team_id"]))
        rows.append(row)
    return rows


def build_match_timeline_rows(
    match_dto: TimelineMatch,
    timeline_payload: MatchTimelineDTO | None,
) -> list[dict[str, Any]]:
    """Build participant timeline aggregates for objective-focused analytics."""
    if timeline_payload is None:
        return []

    frames = timeline_payload.info.frames
    participant_team_by_id, rows_by_participant_id = _collect_participant_rows(
        match_dto
    )
    if not rows_by_participant_id:
        return []

    team_totals = _new_team_totals()
    game_version = match_dto.info.game_version
    _process_timeline_frames(
        frames,
        match_dto.metadata.match_id,
        game_version,
        _uses_historical_atakhan_contract(game_version),
        participant_team_by_id,
        rows_by_participant_id,
        team_totals,
    )
    return _finalize_timeline_rows(rows_by_participant_id, team_totals)


async def replace_match_timeline_rows(
    db: AsyncSession,
    match_dto: TimelineMatch,
    timeline_payload: MatchTimelineDTO | None,
) -> int:
    """Replace timeline rows for one match when timeline payload is available."""
    rows = build_match_timeline_rows(match_dto, timeline_payload)
    if not rows:
        return 0

    match_id = match_dto.metadata.match_id
    await db.execute(delete(MatchTimeline).where(MatchTimeline.match_id == match_id))

    # Write what is already pending before adding rows that point at it: with
    # `autoflush=False` and no `relationship()` edges, SQLAlchemy orders the
    # flush by `"<module>.<ClassName>"`, putting this table ahead of
    # `core.players`. The four dead Match Fetcher runs: `.claude/pitfalls.md`.
    await db.flush()

    for row in rows:
        db.add(MatchTimeline(**row))

    return len(rows)
