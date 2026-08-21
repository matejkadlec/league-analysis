"""Drop the timeline counters that sum `objective_events`.

Revision ID: 20260821_0028
Revises: 20260821_0027
Create Date: 2026-08-21
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "20260821_0028"
down_revision = "20260821_0027"
branch_labels = None
depends_on = None

# `core.match_timelines` had 37 columns and six readers: the team objective
# totals `empty_team_stats` seeds in `match_history.py`. Everything dropped
# here was written on every timeline row and read by nothing.
#
# The sixteen takedown/last-hit counters and the four JSONB breakdowns are
# sums over `objective_events`, which is kept: one entry per objective the
# participant took part in, carrying timestamp, objective, role (K/A), lane,
# subtype and monster type. Anything the counters answered, the log answers --
# `turret_takedowns` is the entries with `o = turret`, `turret_last_hits` those
# of them with `r = K`, `turret_takedowns_by_lane` the same grouped by `l`.
# The log is the record; the counters were a projection nobody selected.
# Verified against production first, over all 9,810 timeline rows: every row's
# `turret_takedowns`, `objective_takedowns_total` and `dragon_last_hits` equal
# the counts recomputed from its own `objective_events`.
#
# `frame_interval_ms` and `frame_count` describe the shape of a frame series
# this table does not store, so they answer nothing once the frames are gone.
DROPPED_COLUMNS: tuple[sa.Column[object], ...] = (
    sa.Column("frame_interval_ms", sa.Integer(), nullable=True),
    sa.Column("frame_count", sa.Integer(), nullable=True),
    *(
        sa.Column(name, sa.Integer(), nullable=False, server_default="0")
        for name in (
            "objective_takedowns_total",
            "objective_last_hits_total",
            "turret_takedowns",
            "turret_last_hits",
            "inhibitor_takedowns",
            "inhibitor_last_hits",
            "dragon_takedowns",
            "dragon_last_hits",
            "rift_herald_takedowns",
            "rift_herald_last_hits",
            "baron_takedowns",
            "baron_last_hits",
            "voidgrub_takedowns",
            "voidgrub_last_hits",
            "atakhan_takedowns",
            "atakhan_last_hits",
        )
    ),
    *(
        sa.Column(name, JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb"))
        for name in (
            "turret_takedowns_by_lane",
            "inhibitor_takedowns_by_lane",
            "dragon_takedowns_by_subtype",
            "other_epic_monster_takedowns",
        )
    ),
)


# The column comment is part of the schema the validator compares, and this
# revision is what makes the log the only per-participant record, so it says so
# on the column.
EVENTS_COMMENT = (
    "Compact objective event log.\n"
    "Each object uses short keys: t=timestamp, o=objective, "
    "r=role(K/A), optional l=lane, s=subtype, m=monsterType.\n"
    "This is the per-participant record: twenty-two counter columns "
    "used to hold sums over exactly these entries and nothing read "
    "any of them (revision 0028)."
)
PREVIOUS_EVENTS_COMMENT = (
    "Compact objective event log.\n"
    "Each object uses short keys: t=timestamp, o=objective, "
    "r=role(K/A), optional l=lane, s=subtype, m=monsterType."
)


def upgrade() -> None:
    for column in DROPPED_COLUMNS:
        op.drop_column("match_timelines", column.name, schema="core")
    op.alter_column(
        "match_timelines",
        "objective_events",
        existing_type=JSONB(),
        existing_nullable=False,
        existing_server_default=sa.text("'[]'::jsonb"),
        comment=EVENTS_COMMENT,
        existing_comment=PREVIOUS_EVENTS_COMMENT,
        schema="core",
    )


def downgrade() -> None:
    """Re-add the columns at their defaults.

    Refilling them means replaying `objective_events`, which the application
    does better than a migration can: `build_match_timeline_rows` reads the
    same events out of a re-fetched Riot timeline.
    """
    op.alter_column(
        "match_timelines",
        "objective_events",
        existing_type=JSONB(),
        existing_nullable=False,
        existing_server_default=sa.text("'[]'::jsonb"),
        comment=PREVIOUS_EVENTS_COMMENT,
        existing_comment=EVENTS_COMMENT,
        schema="core",
    )
    for column in DROPPED_COLUMNS:
        op.add_column("match_timelines", column, schema="core")
