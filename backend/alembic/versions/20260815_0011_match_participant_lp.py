"""Persist per-match LP observations with provenance.

Revision ID: 20260815_0011
Revises: 20260814_0010
Create Date: 2026-08-15
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260815_0011"
down_revision = "20260814_0010"
branch_labels = None
depends_on = None

TABLE_NAME = "match_participants"


def upgrade() -> None:
    """Add LP value and provenance fields, then backfill only certain history."""
    op.add_column(
        TABLE_NAME,
        sa.Column(
            "lp_change",
            sa.Integer(),
            nullable=True,
            comment="Observed Solo/Duo LP change; null when unavailable",
        ),
        schema="core",
    )
    op.add_column(
        TABLE_NAME,
        sa.Column(
            "lp_change_source",
            sa.String(length=32),
            nullable=True,
            comment="Provenance of the persisted LP value or unavailable state",
        ),
        schema="core",
    )
    op.add_column(
        TABLE_NAME,
        sa.Column(
            "lp_change_reason",
            sa.String(length=64),
            nullable=True,
            comment="Stable reason for the LP observation result",
        ),
        schema="core",
    )
    op.add_column(
        TABLE_NAME,
        sa.Column(
            "lp_before_snapshot_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="League snapshot preceding the LP observation window",
        ),
        schema="core",
    )
    op.add_column(
        TABLE_NAME,
        sa.Column(
            "lp_after_snapshot_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="League snapshot closing the LP observation window",
        ),
        schema="core",
    )
    op.execute(
        "UPDATE core.match_participants AS participant "
        "SET lp_change = CASE WHEN participant.remake THEN 0 ELSE NULL END, "
        "lp_change_source = CASE WHEN participant.remake "
        "THEN 'riot_match_remake' ELSE 'unavailable' END, "
        "lp_change_reason = CASE WHEN participant.remake "
        "THEN 'riot_eligible_for_progression_false' "
        "ELSE 'historical_without_observation' END "
        "FROM core.matches AS match "
        "WHERE match.match_id = participant.match_id AND match.queue_id = 420"
    )


def downgrade() -> None:
    """Remove persisted LP observation fields."""
    op.drop_column(TABLE_NAME, "lp_after_snapshot_at", schema="core")
    op.drop_column(TABLE_NAME, "lp_before_snapshot_at", schema="core")
    op.drop_column(TABLE_NAME, "lp_change_reason", schema="core")
    op.drop_column(TABLE_NAME, "lp_change_source", schema="core")
    op.drop_column(TABLE_NAME, "lp_change", schema="core")
