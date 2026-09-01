"""Persist explained smurf and boost detection runs.

Revision ID: 20260814_0010
Revises: 20260813_0010
Create Date: 2026-08-14
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260814_0010"
down_revision = "20260813_0010"
branch_labels = None
depends_on = None

TABLE_NAME = "smurf_boost_analyses"
ACTIVE_STATUSES = "'pending', 'in_progress'"


def upgrade() -> None:
    """Add authoritative persistence for smurf and boost detection runs."""
    op.create_table(
        TABLE_NAME,
        sa.Column(
            "puuid",
            sa.String(length=78),
            nullable=False,
            comment="Player PUUID this analysis is for",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
            comment="When this analysis run was created",
        ),
        sa.Column(
            "status",
            sa.String(length=32),
            nullable=False,
            server_default="pending",
            comment="Authoritative run lifecycle state",
        ),
        sa.Column(
            "model_version",
            sa.String(length=32),
            nullable=False,
            comment="Detection model version that produced this row",
        ),
        sa.Column(
            "thresholds",
            sa.dialects.postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            comment="Exact threshold set the run was computed with",
        ),
        sa.Column(
            "results",
            sa.dialects.postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
            comment="Explained per-family bands, signals, confidence and notes",
        ),
        sa.Column(
            "eligible_games",
            sa.Integer(),
            nullable=False,
            server_default="0",
            comment="Eligible ranked games available when the run executed",
        ),
        sa.Column(
            "latest_match_id",
            sa.String(length=32),
            nullable=True,
            comment="Newest eligible match the run considered, for staleness checks",
        ),
        sa.Column(
            "error_code",
            sa.String(length=64),
            nullable=True,
            comment="Stable client-safe failure classification",
        ),
        sa.Column(
            "error_message",
            sa.String(length=500),
            nullable=True,
            comment="Reviewed user-safe terminal failure message",
        ),
        sa.Column(
            "completed_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="When the run reached a terminal state",
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'in_progress', 'completed', 'failed')",
            name="status_valid",
        ),
        sa.PrimaryKeyConstraint("puuid", "created_at", name=f"pk_{TABLE_NAME}"),
        schema="core",
    )
    op.create_index(
        f"uq_{TABLE_NAME}_active_puuid",
        TABLE_NAME,
        ["puuid"],
        unique=True,
        schema="core",
        postgresql_where=sa.text(f"status IN ({ACTIVE_STATUSES})"),
    )
    # The primary key on (puuid, created_at) already serves the newest-run
    # lookup in either scan direction, so no separate index is created for it.


def downgrade() -> None:
    """Remove smurf and boost detection persistence."""
    op.drop_index(f"uq_{TABLE_NAME}_active_puuid", table_name=TABLE_NAME, schema="core")
    op.drop_table(TABLE_NAME, schema="core")
