"""Create the initial League Analysis PostgreSQL schemas and objects.

Revision ID: 20260803_0001
Revises:
Create Date: 2026-08-03
"""

from __future__ import annotations

from pathlib import Path

from alembic import op

revision = "20260803_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create the complete baseline from the immutable revision payload."""
    baseline = Path(__file__).with_suffix(".sql")
    op.get_bind().execution_options(no_parameters=True).exec_driver_sql(
        baseline.read_text(encoding="utf-8")
    )


def downgrade() -> None:
    """Refuse destructive baseline reversal; restore from backup instead."""
    raise NotImplementedError(
        "The initial League Analysis schema revision is intentionally "
        "non-reversible. Restore a verified backup instead of dropping "
        "application schemas."
    )
