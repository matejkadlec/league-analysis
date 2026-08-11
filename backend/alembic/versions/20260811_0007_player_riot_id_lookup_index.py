"""Index the case-normalized Riot ID lookup used by player discovery.

Revision ID: 20260811_0007
Revises: 20260809_0006
Create Date: 2026-08-11
"""

from __future__ import annotations

from alembic import op

revision = "20260811_0007"
down_revision = "20260809_0006"
branch_labels = None
depends_on = None

INDEX_NAME = "ix_players_lower_riot_id"


def upgrade() -> None:
    """Match the stale-PUUID lookup that runs on every player discovery."""
    op.execute(
        f"CREATE INDEX {INDEX_NAME} ON core.players"
        " (lower(game_name), lower(tag_line), lower(platform))"
    )


def downgrade() -> None:
    """Drop the Riot ID lookup index."""
    op.execute(f"DROP INDEX core.{INDEX_NAME}")
