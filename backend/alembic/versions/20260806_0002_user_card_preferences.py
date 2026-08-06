"""Add versioned viewer-owned analytical card preferences.

Revision ID: 20260806_0002
Revises: 20260803_0001
Create Date: 2026-08-06
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "20260806_0002"
down_revision = "20260803_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create version-coexistent preferences without duplicating player data."""
    op.create_table(
        "user_card_preferences",
        sa.Column(
            "user_id",
            sa.BigInteger(),
            nullable=False,
            comment="Authenticated viewer that owns this preference",
        ),
        sa.Column(
            "card_id",
            sa.String(length=64),
            nullable=False,
            comment="Stable card catalog identifier",
        ),
        sa.Column(
            "version",
            sa.Integer(),
            nullable=False,
            comment="Version of the card-specific settings contract",
        ),
        sa.Column(
            "settings",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            comment="Validated mutable settings only; fixed defaults are normalized on read",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
            comment="When this versioned override was first stored",
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
            comment="When this versioned override was most recently updated",
        ),
        sa.CheckConstraint("version > 0", name="positive_version"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["auth.users.id"],
            name="fk_user_card_preferences_user_id_users",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "user_id",
            "card_id",
            "version",
            name="pk_user_card_preferences",
        ),
        schema="auth",
    )
    op.create_index(
        "ix_user_card_preferences_user_updated",
        "user_card_preferences",
        ["user_id", "updated_at"],
        unique=False,
        schema="auth",
    )


def downgrade() -> None:
    """Remove the preference table when rolling back this isolated addition."""
    op.drop_index(
        "ix_user_card_preferences_user_updated",
        table_name="user_card_preferences",
        schema="auth",
    )
    op.drop_table("user_card_preferences", schema="auth")
