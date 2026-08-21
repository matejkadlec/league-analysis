"""Make the generated `kda` column NOT NULL, as its own expression guarantees.

Revision ID: 20260821_0021
Revises: 20260820_0020
Create Date: 2026-08-21
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260821_0021"
down_revision = "20260820_0020"
branch_labels = None
depends_on = None

# `kda` is a stored generated column:
#   CASE WHEN deaths = 0 THEN kills + assists
#        ELSE ROUND((kills + assists)::numeric / deaths, 2) END
# `kills`, `deaths` and `assists` are all NOT NULL integers, so neither branch
# can evaluate to NULL and Postgres recomputes the value for every row it
# writes. The column was nullable only because nothing ever said otherwise.
# Production agrees: 37,710 participant rows, zero NULLs, checked before this
# was written.
#
# The point is not the constraint, it is what the constraint lets the API say.
# While `kda` was nullable the response schema carried `float | None`, so the
# frontend needed a branch for a value that has never existed -- and the branch
# it grew read `Perfect`, on the 1,715 production rows where the KDA is a
# genuine 0.00.


def upgrade() -> None:
    """State the invariant the generation expression already enforces."""
    op.alter_column(
        "match_participants",
        "kda",
        existing_type=sa.Numeric(5, 2),
        nullable=False,
        schema="core",
    )


def downgrade() -> None:
    """Return the column to the nullable shape revision 0020 had."""
    op.alter_column(
        "match_participants",
        "kda",
        existing_type=sa.Numeric(5, 2),
        nullable=True,
        schema="core",
    )
