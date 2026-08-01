"""Match timeline model and objective-focused transformation helpers."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional

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
    frame_interval_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    frame_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

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
    turret_takedowns_by_lane: Mapped[Dict[str, int]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    inhibitor_takedowns_by_lane: Mapped[Dict[str, int]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    dragon_takedowns_by_subtype: Mapped[Dict[str, int]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    other_epic_monster_takedowns: Mapped[Dict[str, int]] = mapped_column(
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
    team_other_epic_monsters_slain: Mapped[Dict[str, int]] = mapped_column(
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


def _normalize_int(value: Any) -> Optional[int]:
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


def _normalize_text(value: Any) -> Optional[str]:
    """Normalize values to uppercase non-empty text."""
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    return cleaned.upper()


def _increment_counter(counter: Dict[str, int], key: str) -> None:
    """Increment a string-keyed integer counter."""
    counter[key] = counter.get(key, 0) + 1


def _collect_involved_participants(
    event: Dict[str, Any],
    valid_participant_ids: set[int],
) -> tuple[Optional[int], list[int]]:
    """Extract unique participant IDs involved in an objective event."""
    killer_raw = _normalize_int(event.get("killerId"))
    killer_id = killer_raw if killer_raw in valid_participant_ids else None

    involved: list[int] = []
    seen: set[int] = set()

    if killer_id is not None:
        involved.append(killer_id)
        seen.add(killer_id)

    assisting_ids = event.get("assistingParticipantIds")
    if isinstance(assisting_ids, list):
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
    event: Dict[str, Any],
    killer_id: Optional[int],
    participant_team_by_id: Dict[int, int],
) -> Optional[int]:
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
    row: Dict[str, Any],
    timestamp: Optional[int],
    objective: str,
    role: str,
    lane: Optional[str] = None,
    subtype: Optional[str] = None,
    monster_type: Optional[str] = None,
) -> None:
    """Append a compact objective event entry to row JSON."""
    if timestamp is None:
        return

    entry: Dict[str, Any] = {"t": timestamp, "o": objective, "r": role}
    if lane:
        entry["l"] = lane
    if subtype:
        entry["s"] = subtype
    if monster_type:
        entry["m"] = monster_type

    row["objective_events"].append(entry)


def build_match_timeline_rows(
    match_dto: Any,
    timeline_payload: Optional[Dict[str, Any]],
) -> list[Dict[str, Any]]:
    """Build participant timeline aggregates for objective-focused analytics."""
    if not timeline_payload or not isinstance(timeline_payload, dict):
        return []

    info = timeline_payload.get("info")
    if not isinstance(info, dict):
        return []

    frames = info.get("frames")
    if not isinstance(frames, list):
        return []

    match_id = match_dto.metadata.match_id
    frame_interval_ms = _normalize_int(info.get("frameInterval"))
    frame_count = len(frames)

    participant_team_by_id: Dict[int, int] = {}
    rows_by_participant_id: Dict[int, Dict[str, Any]] = {}

    for participant in match_dto.info.participants:
        participant_id = _normalize_int(getattr(participant, "participant_id", None))
        team_id = _normalize_int(getattr(participant, "team_id", None))

        if participant_id is None or team_id not in VALID_TEAM_IDS:
            continue

        participant_team_by_id[participant_id] = team_id
        rows_by_participant_id[participant_id] = {
            "match_id": match_id,
            "puuid": participant.puuid,
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

    if not rows_by_participant_id:
        return []

    team_totals: Dict[int, Dict[str, Any]] = {
        100: {
            "team_turrets_destroyed": 0,
            "team_inhibitors_destroyed": 0,
            "team_dragons_slain": 0,
            "team_rift_heralds_slain": 0,
            "team_barons_slain": 0,
            "team_voidgrubs_slain": 0,
            "team_atakhan_slain": 0,
            "team_other_epic_monsters_slain": {},
        },
        200: {
            "team_turrets_destroyed": 0,
            "team_inhibitors_destroyed": 0,
            "team_dragons_slain": 0,
            "team_rift_heralds_slain": 0,
            "team_barons_slain": 0,
            "team_voidgrubs_slain": 0,
            "team_atakhan_slain": 0,
            "team_other_epic_monsters_slain": {},
        },
    }

    valid_participant_ids = set(rows_by_participant_id.keys())

    for frame in frames:
        if not isinstance(frame, dict):
            continue
        events = frame.get("events")
        if not isinstance(events, list):
            continue

        for event in events:
            if not isinstance(event, dict):
                continue

            event_type = event.get("type")
            if event_type not in {"BUILDING_KILL", "ELITE_MONSTER_KILL"}:
                continue

            killer_id, involved = _collect_involved_participants(
                event, valid_participant_ids
            )

            killer_team_id = _determine_killer_team_id(
                event, killer_id, participant_team_by_id
            )
            timestamp = _normalize_int(event.get("timestamp"))

            if event_type == "BUILDING_KILL":
                building_type = _normalize_text(event.get("buildingType"))
                lane_type = _normalize_text(event.get("laneType"))
                tower_type = _normalize_text(event.get("towerType"))

                objective: Optional[str] = None
                team_total_field: Optional[str] = None
                lane_field: Optional[str] = None
                subtype: Optional[str] = None

                if building_type == "TOWER_BUILDING":
                    objective = "turret"
                    team_total_field = "team_turrets_destroyed"
                    lane_field = "turret_takedowns_by_lane"
                    subtype = tower_type
                elif building_type == "INHIBITOR_BUILDING":
                    objective = "inhibitor"
                    team_total_field = "team_inhibitors_destroyed"
                    lane_field = "inhibitor_takedowns_by_lane"

                if (
                    objective is not None
                    and team_total_field is not None
                    and killer_team_id in VALID_TEAM_IDS
                ):
                    team_totals[killer_team_id][team_total_field] += 1

                if objective is None:
                    continue

                for participant_id in involved:
                    row = rows_by_participant_id.get(participant_id)
                    if row is None:
                        continue

                    row[f"{objective}_takedowns"] += 1
                    row["objective_takedowns_total"] += 1

                    role = "A"
                    if killer_id is not None and participant_id == killer_id:
                        row[f"{objective}_last_hits"] += 1
                        row["objective_last_hits_total"] += 1
                        role = "K"

                    if lane_type and lane_field is not None:
                        _increment_counter(row[lane_field], lane_type)

                    _append_compact_objective_event(
                        row=row,
                        timestamp=timestamp,
                        objective=objective,
                        role=role,
                        lane=lane_type,
                        subtype=subtype,
                    )

                continue

            monster_type = _normalize_text(event.get("monsterType"))
            monster_subtype = _normalize_text(event.get("monsterSubType"))
            if monster_type is None:
                continue

            objective = None
            team_total_field = None

            if monster_type == "DRAGON":
                objective = "dragon"
                team_total_field = "team_dragons_slain"
            elif monster_type == "RIFTHERALD":
                objective = "rift_herald"
                team_total_field = "team_rift_heralds_slain"
            elif monster_type == "BARON_NASHOR":
                objective = "baron"
                team_total_field = "team_barons_slain"
            elif monster_type == "HORDE":
                objective = "voidgrub"
                team_total_field = "team_voidgrubs_slain"
            elif monster_type == "ATAKHAN":
                objective = "atakhan"
                team_total_field = "team_atakhan_slain"

            if (
                objective is not None
                and team_total_field is not None
                and killer_team_id in VALID_TEAM_IDS
            ):
                team_totals[killer_team_id][team_total_field] += 1
            elif killer_team_id in VALID_TEAM_IDS:
                _increment_counter(
                    team_totals[killer_team_id]["team_other_epic_monsters_slain"],
                    monster_type,
                )

            for participant_id in involved:
                row = rows_by_participant_id.get(participant_id)
                if row is None:
                    continue

                role = "A"
                if killer_id is not None and participant_id == killer_id:
                    role = "K"

                if objective in OBJECTIVE_KINDS:
                    row[f"{objective}_takedowns"] += 1
                    row["objective_takedowns_total"] += 1

                    if role == "K":
                        row[f"{objective}_last_hits"] += 1
                        row["objective_last_hits_total"] += 1

                    if objective == "dragon" and monster_subtype is not None:
                        _increment_counter(
                            row["dragon_takedowns_by_subtype"], monster_subtype
                        )

                    _append_compact_objective_event(
                        row=row,
                        timestamp=timestamp,
                        objective=objective,
                        role=role,
                        subtype=monster_subtype,
                    )
                else:
                    _increment_counter(
                        row["other_epic_monster_takedowns"], monster_type
                    )
                    _append_compact_objective_event(
                        row=row,
                        timestamp=timestamp,
                        objective="other_epic_monster",
                        role=role,
                        subtype=monster_subtype,
                        monster_type=monster_type,
                    )

    rows: list[Dict[str, Any]] = []
    for participant_id in sorted(rows_by_participant_id.keys()):
        row = rows_by_participant_id[participant_id]
        totals = team_totals.get(row["team_id"])

        if totals is not None:
            row["team_turrets_destroyed"] = totals["team_turrets_destroyed"]
            row["team_inhibitors_destroyed"] = totals["team_inhibitors_destroyed"]
            row["team_dragons_slain"] = totals["team_dragons_slain"]
            row["team_rift_heralds_slain"] = totals["team_rift_heralds_slain"]
            row["team_barons_slain"] = totals["team_barons_slain"]
            row["team_voidgrubs_slain"] = totals["team_voidgrubs_slain"]
            row["team_atakhan_slain"] = totals["team_atakhan_slain"]
            row["team_other_epic_monsters_slain"] = dict(
                totals["team_other_epic_monsters_slain"]
            )

        row["turret_takedowns_by_lane"] = dict(row["turret_takedowns_by_lane"])
        row["inhibitor_takedowns_by_lane"] = dict(row["inhibitor_takedowns_by_lane"])
        row["dragon_takedowns_by_subtype"] = dict(row["dragon_takedowns_by_subtype"])
        row["other_epic_monster_takedowns"] = dict(row["other_epic_monster_takedowns"])
        rows.append(row)

    return rows


async def replace_match_timeline_rows(
    db: AsyncSession,
    match_dto: Any,
    timeline_payload: Optional[Dict[str, Any]],
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
