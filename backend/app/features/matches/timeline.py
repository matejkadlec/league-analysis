"""Match timeline model and objective-focused transformation helpers."""

from __future__ import annotations

from datetime import datetime
from typing import Any, TypeIs

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
from sqlalchemy import (
    DateTime as SQLDateTime,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.models import Base

logger = structlog.get_logger(__name__)

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

_BUILDING_SPECS: dict[str, tuple[str, str, str, bool]] = {
    "TOWER_BUILDING": (
        "turret",
        "team_turrets_destroyed",
        "turret_takedowns_by_lane",
        True,
    ),
    "INHIBITOR_BUILDING": (
        "inhibitor",
        "team_inhibitors_destroyed",
        "inhibitor_takedowns_by_lane",
        False,
    ),
}

_MONSTER_SPECS: dict[str, tuple[str, str]] = {
    "DRAGON": ("dragon", "team_dragons_slain"),
    "RIFTHERALD": ("rift_herald", "team_rift_heralds_slain"),
    "BARON_NASHOR": ("baron", "team_barons_slain"),
    "HORDE": ("voidgrub", "team_voidgrubs_slain"),
}

_TEAM_TOTAL_COPY_FIELDS = (
    "team_turrets_destroyed",
    "team_inhibitors_destroyed",
    "team_dragons_slain",
    "team_rift_heralds_slain",
    "team_barons_slain",
    "team_voidgrubs_slain",
    "team_atakhan_slain",
)

_COUNTER_COPY_FIELDS = (
    "turret_takedowns_by_lane",
    "inhibitor_takedowns_by_lane",
    "dragon_takedowns_by_subtype",
    "other_epic_monster_takedowns",
)


class MatchTimeline(Base):
    """Objective-focused timeline aggregates per participant."""

    __tablename__ = "match_timelines"
    __table_args__ = (
        UniqueConstraint(
            "match_id",
            "participant_id",
            name="uq_match_timelines_match_participant",
        ),
        CheckConstraint(
            "participant_id BETWEEN 1 AND 10",
            name="ck_match_timelines_participant_id_range",
        ),
        CheckConstraint(
            "team_id IN (100, 200)", name="ck_match_timelines_team_id_valid"
        ),
        {"schema": "core"},
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
    frame_interval_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    frame_count: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Player objective contribution (takedown = killer or assister).
    objective_takedowns_total: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )
    objective_last_hits_total: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )

    turret_takedowns: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    turret_last_hits: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    inhibitor_takedowns: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    inhibitor_last_hits: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    dragon_takedowns: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    dragon_last_hits: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rift_herald_takedowns: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )
    rift_herald_last_hits: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )
    baron_takedowns: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    baron_last_hits: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    voidgrub_takedowns: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    voidgrub_last_hits: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    atakhan_takedowns: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    atakhan_last_hits: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Compact breakdowns for flexible analytics.
    turret_takedowns_by_lane: Mapped[dict[str, int]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    inhibitor_takedowns_by_lane: Mapped[dict[str, int]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    dragon_takedowns_by_subtype: Mapped[dict[str, int]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    other_epic_monster_takedowns: Mapped[dict[str, int]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )

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

    # Small objective event log with compact entries (t=timestamp, o=objective, r=role).
    objective_events: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb")
    )

    created_at: Mapped[datetime] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    match = relationship("Match")
    player = relationship("Player")


Index("idx_match_timelines_puuid", MatchTimeline.puuid)
Index("idx_match_timelines_match_team", MatchTimeline.match_id, MatchTimeline.team_id)


def _is_json_object(value: object) -> TypeIs[dict[str, Any]]:
    """Narrow an unvalidated timeline fragment to a string-keyed object.

    Timeline payloads arrive straight off Riot's wire, so a declared dict type
    is a claim about the format rather than a guarantee. The runtime checks
    below stay, and narrowing through them keeps each fragment typed.
    """
    return isinstance(value, dict)


def _is_json_array(value: object) -> TypeIs[list[Any]]:
    """Narrow an unvalidated timeline fragment to an array."""
    return isinstance(value, list)


def _normalize_int(value: Any) -> int | None:
    """Normalize values to int where possible."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return None


def _normalize_text(value: Any) -> str | None:
    """Normalize values to uppercase non-empty text."""
    if not isinstance(value, str):
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
        return False


def _collect_involved_participants(
    event: dict[str, Any],
    valid_participant_ids: set[int],
) -> tuple[int | None, list[int]]:
    """Extract unique participant IDs involved in an objective event."""
    killer_raw = _normalize_int(event.get("killerId"))
    killer_id = killer_raw if killer_raw in valid_participant_ids else None

    involved: list[int] = []
    seen: set[int] = set()

    if killer_id is not None:
        involved.append(killer_id)
        seen.add(killer_id)

    assisting_ids = event.get("assistingParticipantIds")
    if _is_json_array(assisting_ids):
        for assist_raw in assisting_ids:
            assist_id = _normalize_int(assist_raw)
            if assist_id is None or assist_id not in valid_participant_ids:
                continue
            if assist_id in seen:
                continue
            involved.append(assist_id)
            seen.add(assist_id)

    return killer_id, involved


def _determine_killer_team_id(
    event: dict[str, Any],
    killer_id: int | None,
    participant_team_by_id: dict[int, int],
) -> int | None:
    """Resolve killer team from event payload and participant mapping."""
    if killer_id is not None:
        killer_team = participant_team_by_id.get(killer_id)
        if killer_team in VALID_TEAM_IDS:
            return killer_team

    explicit_team = _normalize_int(event.get("killerTeamId"))
    if explicit_team in VALID_TEAM_IDS:
        return explicit_team

    if event.get("type") == "BUILDING_KILL":
        destroyed_team = _normalize_int(event.get("teamId"))
        if destroyed_team == 100:
            return 200
        if destroyed_team == 200:
            return 100

    return None


def _append_compact_objective_event(
    row: dict[str, Any],
    timestamp: int | None,
    objective: str,
    role: str,
    lane: str | None = None,
    subtype: str | None = None,
    monster_type: str | None = None,
) -> None:
    """Append a compact objective event entry to row JSON."""
    if timestamp is None:
        return

    entry: dict[str, Any] = {"t": timestamp, "o": objective, "r": role}
    if lane:
        entry["l"] = lane
    if subtype:
        entry["s"] = subtype
    if monster_type:
        entry["m"] = monster_type

    row["objective_events"].append(entry)


def _new_team_total_bucket() -> dict[str, Any]:
    """Create an empty team-level objective totals bucket."""
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
    frame_interval_ms: int | None,
    frame_count: int,
) -> dict[str, Any]:
    """Create an empty participant timeline aggregate row."""
    return {
        "match_id": match_id,
        "puuid": puuid,
        "participant_id": participant_id,
        "team_id": team_id,
        "frame_interval_ms": frame_interval_ms,
        "frame_count": frame_count,
        "objective_takedowns_total": 0,
        "objective_last_hits_total": 0,
        "turret_takedowns": 0,
        "turret_last_hits": 0,
        "inhibitor_takedowns": 0,
        "inhibitor_last_hits": 0,
        "dragon_takedowns": 0,
        "dragon_last_hits": 0,
        "rift_herald_takedowns": 0,
        "rift_herald_last_hits": 0,
        "baron_takedowns": 0,
        "baron_last_hits": 0,
        "voidgrub_takedowns": 0,
        "voidgrub_last_hits": 0,
        "atakhan_takedowns": 0,
        "atakhan_last_hits": 0,
        "turret_takedowns_by_lane": {},
        "inhibitor_takedowns_by_lane": {},
        "dragon_takedowns_by_subtype": {},
        "other_epic_monster_takedowns": {},
        "team_turrets_destroyed": 0,
        "team_inhibitors_destroyed": 0,
        "team_dragons_slain": 0,
        "team_rift_heralds_slain": 0,
        "team_barons_slain": 0,
        "team_voidgrubs_slain": 0,
        "team_atakhan_slain": 0,
        "team_other_epic_monsters_slain": {},
        "objective_events": [],
    }


def _extract_timeline_frames(
    timeline_payload: object,
) -> tuple[dict[str, Any], list[Any]] | None:
    """Return `(info, frames)` when the timeline payload has a usable shape."""
    if not timeline_payload or not _is_json_object(timeline_payload):
        return None
    info = timeline_payload.get("info")
    if not _is_json_object(info):
        return None
    frames = info.get("frames")
    if not _is_json_array(frames):
        return None
    return info, frames


def _collect_participant_rows(
    match_dto: Any,
    frame_interval_ms: int | None,
    frame_count: int,
) -> tuple[dict[int, int], dict[int, dict[str, Any]]]:
    """Index valid participants and their empty timeline rows."""
    participant_team_by_id: dict[int, int] = {}
    rows_by_participant_id: dict[int, dict[str, Any]] = {}
    match_id = match_dto.metadata.match_id

    for participant in match_dto.info.participants:
        participant_id = _normalize_int(getattr(participant, "participant_id", None))
        team_id = _normalize_int(getattr(participant, "team_id", None))
        if participant_id is None or team_id not in VALID_TEAM_IDS:
            continue
        participant_team_by_id[participant_id] = team_id
        rows_by_participant_id[participant_id] = _new_participant_row(
            match_id=match_id,
            puuid=participant.puuid,
            participant_id=participant_id,
            team_id=team_id,
            frame_interval_ms=frame_interval_ms,
            frame_count=frame_count,
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
) -> tuple[str | None, str | None, str | None, str | None]:
    """Map a building kill to objective, team-total, lane, and subtype fields."""
    spec = _BUILDING_SPECS.get(building_type) if building_type is not None else None
    if spec is None:
        return None, None, None, None
    objective, team_field, lane_field, use_tower_subtype = spec
    if use_tower_subtype:
        return objective, team_field, lane_field, tower_type
    return objective, team_field, lane_field, None


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


def _credit_known_objective(
    row: dict[str, Any],
    objective: str,
    role: str,
    timestamp: int | None,
    *,
    lane: str | None = None,
    lane_field: str | None = None,
    subtype: str | None = None,
) -> None:
    """Increment known-objective takedown counters and append a compact event."""
    row[f"{objective}_takedowns"] += 1
    row["objective_takedowns_total"] += 1
    if role == "K":
        row[f"{objective}_last_hits"] += 1
        row["objective_last_hits_total"] += 1
    if lane and lane_field is not None:
        _increment_counter(row[lane_field], lane)
    _append_compact_objective_event(
        row=row,
        timestamp=timestamp,
        objective=objective,
        role=role,
        lane=lane,
        subtype=subtype,
    )


def _credit_monster_takedown(
    row: dict[str, Any],
    objective: str | None,
    role: str,
    timestamp: int | None,
    monster_type: str,
    monster_subtype: str | None,
) -> None:
    """Credit a participant monster takedown or retain an unknown type."""
    if objective in OBJECTIVE_KINDS:
        _credit_known_objective(
            row,
            objective,
            role,
            timestamp,
            subtype=monster_subtype,
        )
        if objective == "dragon" and monster_subtype is not None:
            _increment_counter(row["dragon_takedowns_by_subtype"], monster_subtype)
        return
    _increment_counter(row["other_epic_monster_takedowns"], monster_type)
    _append_compact_objective_event(
        row=row,
        timestamp=timestamp,
        objective="other_epic_monster",
        role=role,
        subtype=monster_subtype,
        monster_type=monster_type,
    )


def _record_unknown_building(
    match_id: str,
    building_type: str | None,
    tower_type: str | None,
    lane_type: str | None,
    timestamp: int | None,
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
    event: dict[str, Any],
    match_id: str,
    killer_id: int | None,
    involved: list[int],
    killer_team_id: int | None,
    rows_by_participant_id: dict[int, dict[str, Any]],
    team_totals: dict[int, dict[str, Any]],
) -> None:
    """Apply a BUILDING_KILL event to team totals and participant rows."""
    building_type = _normalize_text(event.get("buildingType"))
    lane_type = _normalize_text(event.get("laneType"))
    tower_type = _normalize_text(event.get("towerType"))
    timestamp = _normalize_int(event.get("timestamp"))
    objective, team_total_field, lane_field, subtype = _resolve_building_objective(
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
        _credit_known_objective(
            row,
            objective,
            _event_role(killer_id, participant_id),
            timestamp,
            lane=lane_type,
            lane_field=lane_field,
            subtype=subtype,
        )


def _apply_elite_monster_kill(
    event: dict[str, Any],
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
    monster_type = _normalize_text(event.get("monsterType"))
    monster_subtype = _normalize_text(event.get("monsterSubType"))
    timestamp = _normalize_int(event.get("timestamp"))
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
        _credit_monster_takedown(
            row,
            objective,
            _event_role(killer_id, participant_id),
            timestamp,
            monster_type,
            monster_subtype,
        )


def _process_timeline_event(
    event: Any,
    match_id: str,
    game_version: str,
    historical_atakhan: bool,
    valid_participant_ids: set[int],
    participant_team_by_id: dict[int, int],
    rows_by_participant_id: dict[int, dict[str, Any]],
    team_totals: dict[int, dict[str, Any]],
) -> None:
    """Dispatch one timeline event when it is an objective kill."""
    if not _is_json_object(event):
        return
    event_type = event.get("type")
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
    frames: list[Any],
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
        if not _is_json_object(frame):
            continue
        events = frame.get("events")
        if not _is_json_array(events):
            continue
        for event in events:
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
    for field in _TEAM_TOTAL_COPY_FIELDS:
        row[field] = totals[field]
    row["team_other_epic_monsters_slain"] = dict(
        totals["team_other_epic_monsters_slain"]
    )


def _freeze_row_counters(row: dict[str, Any]) -> None:
    """Snapshot mutable counter dicts so later mutations cannot leak."""
    for field in _COUNTER_COPY_FIELDS:
        row[field] = dict(row[field])


def _finalize_timeline_rows(
    rows_by_participant_id: dict[int, dict[str, Any]],
    team_totals: dict[int, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Attach team totals and return rows ordered by participant ID."""
    rows: list[dict[str, Any]] = []
    for participant_id in sorted(rows_by_participant_id.keys()):
        row = rows_by_participant_id[participant_id]
        _apply_team_totals_to_row(row, team_totals.get(row["team_id"]))
        _freeze_row_counters(row)
        rows.append(row)
    return rows


def build_match_timeline_rows(
    match_dto: Any,
    timeline_payload: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    """Build participant timeline aggregates for objective-focused analytics."""
    extracted = _extract_timeline_frames(timeline_payload)
    if extracted is None:
        return []

    info, frames = extracted
    participant_team_by_id, rows_by_participant_id = _collect_participant_rows(
        match_dto,
        _normalize_int(info.get("frameInterval")),
        len(frames),
    )
    if not rows_by_participant_id:
        return []

    team_totals = _new_team_totals()
    game_version = getattr(match_dto.info, "game_version", "") or ""
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
    match_dto: Any,
    timeline_payload: dict[str, Any] | None,
) -> int:
    """Replace timeline rows for one match when timeline payload is available."""
    rows = build_match_timeline_rows(match_dto, timeline_payload)
    if not rows:
        return 0

    match_id = match_dto.metadata.match_id
    await db.execute(delete(MatchTimeline).where(MatchTimeline.match_id == match_id))

    for row in rows:
        db.add(MatchTimeline(**row))

    return len(rows)
