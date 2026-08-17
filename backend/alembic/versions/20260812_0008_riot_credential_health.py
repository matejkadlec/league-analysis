"""Add authoritative Riot credential health.

Revision ID: 20260812_0008
Revises: 20260811_0007
Create Date: 2026-08-12
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260812_0008"
down_revision = "20260811_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Persist one secret-free health record for the effective Riot credential."""
    op.create_table(
        "riot_credential_health",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column(
            "generation",
            sa.String(length=32),
            nullable=False,
            comment="Random non-secret generation identifier for stale-evidence rejection",
        ),
        sa.Column("source", sa.String(length=8), nullable=False),
        sa.Column("db_key_id", sa.Integer(), nullable=True),
        sa.Column("environment_generation", sa.String(length=72), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("evidence", sa.String(length=32), nullable=False),
        sa.Column("evidence_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "revision",
            sa.BigInteger(),
            nullable=False,
            server_default="1",
        ),
        sa.Column("recovered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("recovery_revision", sa.BigInteger(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint("id = 1", name="singleton_id"),
        sa.CheckConstraint("source IN ('none', 'db', 'env')", name="valid_source"),
        sa.CheckConstraint(
            "status IN ('missing', 'unknown', 'valid', 'invalid')",
            name="valid_status",
        ),
        sa.CheckConstraint(
            "evidence IN ('missing', 'configured', 'settings_validation', "
            "'provider_success', 'credential_rejected')",
            name="valid_evidence",
        ),
        sa.CheckConstraint("revision > 0", name="positive_revision"),
        sa.ForeignKeyConstraint(
            ["db_key_id"],
            ["core.riot_api_keys.id"],
            name="fk_riot_credential_health_db_key_id_riot_api_keys",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_riot_credential_health"),
        schema="core",
    )


def downgrade() -> None:
    """Remove authoritative Riot credential health persistence."""
    op.drop_table("riot_credential_health", schema="core")
