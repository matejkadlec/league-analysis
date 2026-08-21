"""Drop the five `player_leagues` columns nothing ever read.

Revision ID: 20260821_0026
Revises: 20260821_0025
Create Date: 2026-08-21
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260821_0026"
down_revision = "20260821_0025"
branch_labels = None
depends_on = None

# `veteran`, `inactive`, `fresh_blood` and `hot_streak` were written on every
# league snapshot, published through `PlayerLeagueResponse` and validated by
# `PlayerLeagueSchema` in the frontend -- and read by nothing on either side.
# `league_id` is the same story with an index on top of it: Riot's by-PUUID
# response does not even carry the value any more, so the column is mostly
# NULL and `idx_leagues_league_id` indexes the nothing.
#
# The four flags were also declared required on `LeagueEntryDTO`, so a Riot
# response that omitted one would have failed the whole league sync over a
# value no caller wanted.
DROPPED_COLUMNS: tuple[tuple[str, sa.Column[object]], ...] = (
    ("league_id", sa.Column("league_id", sa.String(36), nullable=True)),
    (
        "veteran",
        sa.Column("veteran", sa.Boolean(), nullable=False, server_default=sa.false()),
    ),
    (
        "inactive",
        sa.Column("inactive", sa.Boolean(), nullable=False, server_default=sa.false()),
    ),
    (
        "fresh_blood",
        sa.Column(
            "fresh_blood", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    ),
    (
        "hot_streak",
        sa.Column(
            "hot_streak", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    ),
)


def upgrade() -> None:
    op.drop_index("idx_leagues_league_id", table_name="player_leagues", schema="core")
    for name, _column in DROPPED_COLUMNS:
        op.drop_column("player_leagues", name, schema="core")


def downgrade() -> None:
    """Restore the columns and their index; the values themselves are gone."""
    for _name, column in DROPPED_COLUMNS:
        op.add_column("player_leagues", column, schema="core")
    op.create_index(
        "idx_leagues_league_id",
        "player_leagues",
        ["league_id"],
        schema="core",
    )
