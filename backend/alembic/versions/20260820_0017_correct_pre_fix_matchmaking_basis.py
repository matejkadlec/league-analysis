"""Rewrite the matchmaking basis size stored before the formula was fixed.

Revision ID: 20260820_0017
Revises: 20260820_0016
Create Date: 2026-08-20
"""

from __future__ import annotations

from alembic import op

revision = "20260820_0017"
down_revision = "20260820_0016"
branch_labels = None
depends_on = None

# `_build_completion_results` used to compute the basis shown in the UI as
# `10 + 90 * (MATCHES_FOR_WINRATE - 1)` = 820 and now computes
# `10 + 90 * MATCHES_FOR_WINRATE` = 910. Rows written before that fix still
# carry 820, and the results card was rewriting them to 910 on the way to the
# screen -- a data migration living in a render function, which meant the
# database and the UI disagreed about the same row forever.
#
# The value is a constant of the formula, not a count of anything actually
# examined, so no run can legitimately store 820 once this has run and no
# future run can produce it again.
OLD_BASIS = "820"
NEW_BASIS = "910"


def upgrade() -> None:
    """Move pre-fix rows onto the current basis."""
    op.execute(
        f"""
        UPDATE core.matchmaking_analyses
        SET results = jsonb_set(
            results, '{{matches_analyzed}}', '{NEW_BASIS}'::jsonb
        )
        WHERE results ->> 'matches_analyzed' = '{OLD_BASIS}'
        """
    )


def downgrade() -> None:
    """Deliberately nothing.

    This revision corrects data, not schema, so there is no structure for a
    downgrade to undo -- and a reverse `UPDATE` could not be selective: a row
    that genuinely completed after the fix is indistinguishable from one this
    migration moved, so putting 820 back would corrupt every correct analysis
    to unwind a handful of stale ones. Leaving 910 in place is right under
    either revision; the constant only ever moves one way.
    """
