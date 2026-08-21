"""Let the playstyle summary say "no data" with NULL instead of a second shape.

Revision ID: 20260821_0022
Revises: 20260821_0021
Create Date: 2026-08-21
"""

from __future__ import annotations

from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260821_0022"
down_revision = "20260821_0021"
branch_labels = None
depends_on = None

# `summary_stats` was NOT NULL with a `'{}'` server default, so a player with
# no matches had to be recorded as *some* JSON object. The service wrote
# `{"note": "No match data available"}` -- a second, undocumented shape in a
# column whose other rows hold thirteen numeric statistics, and one no reader
# distinguished from the real thing. Typing the column as `SummaryStats`
# leaves NULL as the only honest way to say the analysis found nothing.
#
# Production was checked before this was written: 2 rows, both carrying the
# full thirteen keys, none empty and none with a `note`. The two statements
# below are for development databases and for any row written before the
# service stopped inventing shapes.
#
# `main_role` and `most_played_champion` are normalised in the same pass. They
# used to carry the *string* `"None"` as their absent value, which the new
# `str | None` would faithfully hand a card as the champion named "None".

_TABLE = "core.playstyle_analyses"


def upgrade() -> None:
    """Make the column nullable and retire both stand-ins for absence."""
    op.alter_column(
        "playstyle_analyses",
        "summary_stats",
        existing_type=postgresql.JSONB(),
        existing_server_default="'{}'::jsonb",
        server_default=None,
        nullable=True,
        existing_comment="Summary statistics calculated during analysis",
        comment="Summary statistics, NULL when the player had no matches",
        schema="core",
    )
    op.execute(
        f"UPDATE {_TABLE} SET summary_stats = NULL "
        "WHERE summary_stats = '{}'::jsonb "
        "OR summary_stats->>'note' = 'No match data available'"
    )
    op.execute(
        f"UPDATE {_TABLE} SET summary_stats = summary_stats "
        "|| jsonb_build_object('main_role', NULL) "
        "WHERE summary_stats->>'main_role' = 'None'"
    )
    op.execute(
        f"UPDATE {_TABLE} SET summary_stats = summary_stats "
        "|| jsonb_build_object('most_played_champion', NULL) "
        "WHERE summary_stats->>'most_played_champion' = 'None'"
    )


def downgrade() -> None:
    """Restore the non-null column, filling the rows this revision emptied."""
    op.execute(
        f"UPDATE {_TABLE} SET summary_stats = '{{}}'::jsonb WHERE summary_stats IS NULL"
    )
    op.alter_column(
        "playstyle_analyses",
        "summary_stats",
        existing_type=postgresql.JSONB(),
        server_default="'{}'::jsonb",
        nullable=False,
        existing_comment="Summary statistics, NULL when the player had no matches",
        comment="Summary statistics calculated during analysis",
        schema="core",
    )
