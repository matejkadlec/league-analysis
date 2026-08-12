"""Drop the Riot ID lookup index left unused by removing the PUUID merge.

Revision ID: 20260812_0009
Revises: 20260812_0008
Create Date: 2026-08-12
"""

from __future__ import annotations

from alembic import op

revision = "20260812_0009"
down_revision = "20260812_0008"
branch_labels = None
depends_on = None

INDEX_NAME = "ix_players_lower_riot_id"


def upgrade() -> None:
    """Remove the index whose only query was the deleted PUUID merge lookup."""
    op.execute(f"DROP INDEX IF EXISTS core.{INDEX_NAME}")


def downgrade() -> None:
    """Restore the case-normalized Riot ID lookup index."""
    op.execute(
        f"CREATE INDEX {INDEX_NAME} ON core.players"
        " (lower(game_name), lower(tag_line), lower(platform))"
    )
