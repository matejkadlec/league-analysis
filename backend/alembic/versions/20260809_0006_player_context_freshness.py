"""Persist per-user player context and authoritative sync freshness.

Revision ID: 20260809_0006
Revises: 20260809_0005
Create Date: 2026-08-09
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260809_0006"
down_revision = "20260809_0005"
branch_labels = None
depends_on = None

ACTIVE_SYNC_STATUSES = "'pending', 'running'"


def upgrade() -> None:
    """Add player-context ownership, sync recency, and explicit freshness."""
    op.add_column(
        "user_settings",
        sa.Column(
            "current_player_puuid",
            sa.String(length=78),
            nullable=True,
            comment="Last player selected by this application user",
        ),
        schema="auth",
    )
    op.create_foreign_key(
        "fk_user_settings_current_player_puuid_players",
        "user_settings",
        "players",
        ["current_player_puuid"],
        ["puuid"],
        source_schema="auth",
        referent_schema="core",
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_user_settings_current_player_puuid",
        "user_settings",
        ["current_player_puuid"],
        schema="auth",
    )
    op.execute(
        "UPDATE auth.user_settings AS settings SET current_player_puuid = "
        "CASE "
        "WHEN EXISTS (SELECT 1 FROM core.players AS player "
        "WHERE player.puuid = settings.saved_tracked_puuid) "
        "THEN settings.saved_tracked_puuid "
        "WHEN EXISTS (SELECT 1 FROM auth.users AS app_user "
        "JOIN core.players AS player ON player.puuid = app_user.puuid "
        "WHERE app_user.id = settings.user_id) "
        "THEN (SELECT app_user.puuid FROM auth.users AS app_user "
        "WHERE app_user.id = settings.user_id) "
        "ELSE NULL END"
    )
    for legacy_column in (
        "save_playstyle_url",
        "saved_playstyle_puuid",
        "save_matchmaking_url",
        "saved_matchmaking_puuid",
        "save_tracked_url",
        "saved_tracked_puuid",
    ):
        op.drop_column("user_settings", legacy_column, schema="auth")

    op.add_column(
        "user_tracked_players",
        sa.Column(
            "last_selected_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="When this tracked player was most recently selected",
        ),
        schema="auth",
    )
    op.execute(
        "UPDATE auth.user_tracked_players "
        "SET last_selected_at = tracked_at WHERE last_selected_at IS NULL"
    )
    op.alter_column(
        "user_tracked_players",
        "last_selected_at",
        existing_type=sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("now()"),
        schema="auth",
    )
    op.create_index(
        "ix_user_tracked_players_recent",
        "user_tracked_players",
        ["user_id", "last_selected_at"],
        schema="auth",
    )

    for column_name, comment in (
        ("profile_synced_at", "Last successful Player Updater profile check"),
        ("league_synced_at", "Last successful Match Fetcher rank check"),
        ("match_synced_at", "Last complete successful Match Fetcher match check"),
    ):
        op.add_column(
            "players",
            sa.Column(
                column_name,
                sa.DateTime(timezone=True),
                nullable=True,
                comment=comment,
            ),
            schema="core",
        )

    op.create_table(
        "player_sync_runs",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("puuid", sa.String(length=78), nullable=False),
        sa.Column(
            "status",
            sa.String(length=32),
            nullable=False,
            server_default="pending",
        ),
        sa.Column(
            "match_execution_id",
            sa.Integer(),
            nullable=True,
        ),
        sa.Column(
            "profile_execution_id",
            sa.Integer(),
            nullable=True,
        ),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("error_message", sa.String(length=500), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'running', 'completed', 'failed', "
            "'cancelled', 'rate_limited')",
            name="status_valid",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["auth.users.id"],
            name="fk_player_sync_runs_user_id_users",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["puuid"],
            ["core.players.puuid"],
            name="fk_player_sync_runs_puuid_players",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["match_execution_id"],
            ["jobs.job_executions.id"],
            name="fk_player_sync_runs_match_execution_id_job_executions",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["profile_execution_id"],
            ["jobs.job_executions.id"],
            name="fk_player_sync_runs_profile_execution_id_job_executions",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_player_sync_runs"),
        schema="jobs",
    )
    op.create_index(
        "ix_player_sync_runs_user_created",
        "player_sync_runs",
        ["user_id", "created_at"],
        schema="jobs",
    )
    op.create_index(
        "uq_player_sync_runs_active_puuid",
        "player_sync_runs",
        ["puuid"],
        unique=True,
        schema="jobs",
        postgresql_where=sa.text(f"status IN ({ACTIVE_SYNC_STATUSES})"),
    )


def downgrade() -> None:
    """Remove player-context and freshness persistence."""
    op.drop_index(
        "uq_player_sync_runs_active_puuid",
        table_name="player_sync_runs",
        schema="jobs",
    )
    op.drop_index(
        "ix_player_sync_runs_user_created",
        table_name="player_sync_runs",
        schema="jobs",
    )
    op.drop_table("player_sync_runs", schema="jobs")

    op.add_column(
        "user_settings",
        sa.Column(
            "save_playstyle_url",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        schema="auth",
    )
    op.add_column(
        "user_settings",
        sa.Column("saved_playstyle_puuid", sa.String(length=78), nullable=True),
        schema="auth",
    )
    op.add_column(
        "user_settings",
        sa.Column(
            "save_matchmaking_url",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        schema="auth",
    )
    op.add_column(
        "user_settings",
        sa.Column("saved_matchmaking_puuid", sa.String(length=78), nullable=True),
        schema="auth",
    )
    op.add_column(
        "user_settings",
        sa.Column(
            "save_tracked_url",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        schema="auth",
    )
    op.add_column(
        "user_settings",
        sa.Column("saved_tracked_puuid", sa.String(length=78), nullable=True),
        schema="auth",
    )

    for column_name in ("match_synced_at", "league_synced_at", "profile_synced_at"):
        op.drop_column("players", column_name, schema="core")

    op.drop_index(
        "ix_user_tracked_players_recent",
        table_name="user_tracked_players",
        schema="auth",
    )
    op.drop_column("user_tracked_players", "last_selected_at", schema="auth")
    op.drop_index(
        "ix_user_settings_current_player_puuid",
        table_name="user_settings",
        schema="auth",
    )
    op.drop_constraint(
        "fk_user_settings_current_player_puuid_players",
        "user_settings",
        schema="auth",
        type_="foreignkey",
    )
    op.drop_column("user_settings", "current_player_puuid", schema="auth")
