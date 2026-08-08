"""Preserve Riot match creation and actual start timestamps separately.

Revision ID: 20260808_0004
Revises: 20260808_0003
Create Date: 2026-08-08
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260808_0004"
down_revision = "20260808_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Mark existing start values as legacy creation-time fallbacks."""
    op.add_column(
        "matches",
        sa.Column(
            "game_creation_timestamp",
            sa.BigInteger(),
            nullable=True,
            comment="Riot loading-screen gameCreation timestamp in milliseconds",
        ),
        schema="core",
    )
    op.add_column(
        "matches",
        sa.Column(
            "game_start_timestamp_source",
            sa.String(length=32),
            nullable=False,
            server_default="legacy_game_creation",
            comment="Whether game_start_timestamp is actual or a legacy fallback",
        ),
        schema="core",
    )
    op.execute(
        "UPDATE core.matches "
        "SET game_creation_timestamp = game_start_timestamp, "
        "game_start_timestamp_source = 'legacy_game_creation'"
    )
    op.alter_column(
        "matches",
        "game_creation_timestamp",
        existing_type=sa.BigInteger(),
        nullable=False,
        schema="core",
    )
    op.alter_column(
        "matches",
        "game_start_timestamp_source",
        existing_type=sa.String(length=32),
        existing_nullable=False,
        server_default=None,
        schema="core",
    )
    op.create_check_constraint(
        "start_timestamp_source",
        "matches",
        "game_start_timestamp_source IN ('riot_game_start', 'legacy_game_creation')",
        schema="core",
    )
    op.alter_column(
        "matches",
        "game_start_timestamp",
        existing_type=sa.BigInteger(),
        existing_nullable=False,
        comment=(
            "Actual Riot gameStartTimestamp, or gameCreation only when the source "
            "column marks a legacy fallback"
        ),
        schema="core",
    )


def downgrade() -> None:
    """Return to the legacy single effective timestamp representation."""
    op.drop_constraint(
        op.f("ck_matches_start_timestamp_source"),
        "matches",
        schema="core",
        type_="check",
    )
    op.drop_column("matches", "game_start_timestamp_source", schema="core")
    op.drop_column("matches", "game_creation_timestamp", schema="core")
    op.alter_column(
        "matches",
        "game_start_timestamp",
        existing_type=sa.BigInteger(),
        existing_nullable=False,
        comment="Game creation timestamp in milliseconds since epoch",
        schema="core",
    )
