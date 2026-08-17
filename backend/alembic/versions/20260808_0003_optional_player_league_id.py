"""Allow Riot league snapshots without leagueId.

Revision ID: 20260808_0003
Revises: 20260806_0002
Create Date: 2026-08-08
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260808_0003"
down_revision = "20260806_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Represent an omitted upstream leagueId as SQL NULL."""
    op.alter_column(
        "player_leagues",
        "league_id",
        existing_type=sa.String(length=36),
        nullable=True,
        existing_comment="Riot league ID (UUID)",
        comment="Optional Riot league ID (omitted by current by-PUUID responses)",
        schema="core",
    )


def downgrade() -> None:
    """Restore the old constraint only when no optional snapshots would be lost."""
    null_count = (
        op.get_bind()
        .execute(
            sa.text("SELECT COUNT(*) FROM core.player_leagues WHERE league_id IS NULL")
        )
        .scalar_one()
    )
    if null_count:
        raise RuntimeError(
            "Cannot restore required league_id while NULL league snapshots exist"
        )

    op.alter_column(
        "player_leagues",
        "league_id",
        existing_type=sa.String(length=36),
        nullable=False,
        existing_comment=(
            "Optional Riot league ID (omitted by current by-PUUID responses)"
        ),
        comment="Riot league ID (UUID)",
        schema="core",
    )
