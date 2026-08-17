"""Retire obsolete application settings and Riot account links.

Revision ID: 20260813_0010
Revises: 20260812_0009
Create Date: 2026-08-13
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "20260813_0010"
down_revision = "20260812_0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Preserve useful player context, then remove retired account settings."""
    op.execute(
        "INSERT INTO auth.user_settings (user_id, current_player_puuid) "
        "SELECT app_user.id, app_user.puuid FROM auth.users AS app_user "
        "JOIN core.players AS player ON player.puuid = app_user.puuid "
        "WHERE app_user.puuid IS NOT NULL "
        "ON CONFLICT (user_id) DO NOTHING"
    )
    op.execute(
        "UPDATE auth.user_settings AS settings "
        "SET current_player_puuid = app_user.puuid, updated_at = CURRENT_TIMESTAMP "
        "FROM auth.users AS app_user "
        "JOIN core.players AS player ON player.puuid = app_user.puuid "
        "WHERE settings.user_id = app_user.id "
        "AND settings.current_player_puuid IS NULL"
    )

    op.drop_index("ix_users_puuid", table_name="users", schema="auth")
    op.drop_column("users", "puuid", schema="auth")
    op.drop_column("users", "riot_account_connected", schema="auth")

    op.drop_column("user_settings", "default_platform", schema="auth")
    op.drop_column("user_settings", "theme", schema="auth")
    op.execute("DROP TYPE auth.theme_enum")


def downgrade() -> None:
    """Restore the legacy columns with inert compatibility defaults."""
    theme_enum = postgresql.ENUM(
        "LIGHT",
        "DARK",
        name="theme_enum",
        schema="auth",
        create_type=False,
    )
    theme_enum.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "user_settings",
        sa.Column(
            "theme",
            theme_enum,
            nullable=False,
            server_default=sa.text("'DARK'::auth.theme_enum"),
        ),
        schema="auth",
    )
    op.add_column(
        "user_settings",
        sa.Column(
            "default_platform",
            sa.String(length=4),
            nullable=True,
            server_default="eun1",
        ),
        schema="auth",
    )

    op.add_column(
        "users",
        sa.Column(
            "riot_account_connected",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        schema="auth",
    )
    op.add_column(
        "users",
        sa.Column("puuid", sa.String(length=78), nullable=True),
        schema="auth",
    )
    op.create_index("ix_users_puuid", "users", ["puuid"], schema="auth")
