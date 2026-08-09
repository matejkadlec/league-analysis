"""Persist authoritative matchmaking analysis lifecycle states.

Revision ID: 20260809_0005
Revises: 20260808_0004
Create Date: 2026-08-09
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260809_0005"
down_revision = "20260808_0004"
branch_labels = None
depends_on = None

ACTIVE_STATUSES = "'pending', 'in_progress', 'waiting_rate_limit'"


def upgrade() -> None:
    """Backfill lifecycle state and enforce one active run per player."""
    op.add_column(
        "matchmaking_analyses",
        sa.Column(
            "status",
            sa.String(length=32),
            nullable=False,
            server_default="pending",
            comment="Authoritative analysis lifecycle state",
        ),
        schema="core",
    )
    op.add_column(
        "matchmaking_analyses",
        sa.Column(
            "error_code",
            sa.String(length=64),
            nullable=True,
            comment="Stable client-safe failure classification",
        ),
        schema="core",
    )
    op.add_column(
        "matchmaking_analyses",
        sa.Column(
            "error_message",
            sa.String(length=500),
            nullable=True,
            comment="Reviewed user-safe terminal failure message",
        ),
        schema="core",
    )
    op.execute(
        "UPDATE core.matchmaking_analyses SET "
        "status = CASE "
        "WHEN completed_at IS NOT NULL AND results ? 'error' THEN 'failed' "
        "WHEN completed_at IS NOT NULL THEN 'completed' "
        "WHEN started_at IS NOT NULL THEN 'in_progress' "
        "ELSE 'pending' END, "
        "error_code = CASE "
        "WHEN completed_at IS NOT NULL AND results ? 'error' "
        "THEN 'legacy_analysis_failure' ELSE NULL END, "
        "error_message = CASE "
        "WHEN completed_at IS NOT NULL AND results ? 'error' "
        "THEN 'The analysis did not finish. Please try again.' ELSE NULL END"
    )
    op.execute(
        "WITH ranked_active AS ("
        "SELECT puuid, created_at, ROW_NUMBER() OVER ("
        "PARTITION BY puuid ORDER BY created_at DESC) AS active_rank "
        "FROM core.matchmaking_analyses "
        f"WHERE status IN ({ACTIVE_STATUSES})"
        ") UPDATE core.matchmaking_analyses AS analysis SET "
        "status = 'cancelled', completed_at = COALESCE(analysis.completed_at, now()), "
        "error_code = 'superseded_during_migration', "
        "error_message = 'This older unfinished analysis was replaced.' "
        "FROM ranked_active WHERE analysis.puuid = ranked_active.puuid "
        "AND analysis.created_at = ranked_active.created_at "
        "AND ranked_active.active_rank > 1"
    )
    op.create_check_constraint(
        "status_valid",
        "matchmaking_analyses",
        "status IN ('pending', 'in_progress', 'waiting_rate_limit', "
        "'completed', 'failed', 'cancelled')",
        schema="core",
    )
    op.create_index(
        "uq_matchmaking_analyses_active_puuid",
        "matchmaking_analyses",
        ["puuid"],
        unique=True,
        schema="core",
        postgresql_where=sa.text(f"status IN ({ACTIVE_STATUSES})"),
    )


def downgrade() -> None:
    """Remove explicit lifecycle state after retaining terminal timestamps."""
    op.drop_index(
        "uq_matchmaking_analyses_active_puuid",
        table_name="matchmaking_analyses",
        schema="core",
    )
    op.drop_constraint(
        op.f("ck_matchmaking_analyses_status_valid"),
        "matchmaking_analyses",
        schema="core",
        type_="check",
    )
    op.drop_column("matchmaking_analyses", "error_message", schema="core")
    op.drop_column("matchmaking_analyses", "error_code", schema="core")
    op.drop_column("matchmaking_analyses", "status", schema="core")
