"""Drop the rate-limit coordination table with the limiter that wrote it.

Revision ID: 20260820_0018
Revises: 20260820_0017
Create Date: 2026-08-20
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260820_0018"
down_revision = "20260820_0017"
branch_labels = None
depends_on = None

# `core.rate_limit_state` existed so three components could coordinate their
# share of Riot's application limit through the database. Nothing was ever
# being coordinated: the deployment is one container running one uvicorn
# worker with the scheduler in its own event loop, and the limiter that owned
# this table enforced its burst spacing with a process-local `asyncio.Lock`.
# The window it tracked was a guess -- 100 requests per 120 seconds, hardcoded
# -- sitting in front of `RiotAPIClient`, whose own limiter reads the real
# numbers out of Riot's `X-App-Rate-Limit` response headers and waits them out.
#
# The rows were pure runtime bookkeeping, so nothing here is worth preserving.
# The downgrade rebuilds the structure, empty.


def upgrade() -> None:
    """Remove the table, its index and its sequence."""
    op.drop_index(
        "idx_rate_limit_priority_waiting", table_name="rate_limit_state", schema="core"
    )
    op.drop_table("rate_limit_state", schema="core")


def downgrade() -> None:
    """Recreate the table as the baseline declared it, without its rows."""
    op.create_table(
        "rate_limit_state",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("component", sa.String(length=50), nullable=False),
        sa.Column("priority", sa.Integer(), server_default="3", nullable=False),
        sa.Column("requests_made", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "window_start",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "window_size_seconds", sa.Integer(), server_default="120", nullable=False
        ),
        sa.Column("max_requests", sa.Integer(), server_default="100", nullable=False),
        sa.Column(
            "is_waiting",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="rate_limit_state_pkey"),
        sa.UniqueConstraint("component", name="rate_limit_state_component_key"),
        schema="core",
        comment="Central rate limit state for all Riot API components",
    )
    op.create_index(
        "idx_rate_limit_priority_waiting",
        "rate_limit_state",
        ["priority", "is_waiting"],
        unique=False,
        schema="core",
    )
