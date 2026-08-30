"""Leave one spelling of "no document" in every nullable JSONB column.

Revision ID: 20260829_0034
Revises: 20260826_0033
Create Date: 2026-08-29
"""

from __future__ import annotations

from alembic import op

revision = "20260829_0034"
down_revision = "20260826_0033"
branch_labels = None
depends_on = None

# `JSON.none_as_null` defaults to False, so every `None` written to one of
# these columns landed as the document `null`: read back as `None`, invisible
# to `IS NULL`. The models set the flag now; these rows predate that.
ABSENT_JSONB_COLUMNS: tuple[tuple[str, str, str], ...] = (
    ("core", "matchmaking_analyses", "results"),
    ("core", "matchmaking_analyses", "puuid_progress"),
    ("core", "playstyle_analyses", "summary_stats"),
    ("core", "smurf_boost_analyses", "results"),
    ("core", "match_participants", "runes"),
    ("core", "match_participants", "advanced_stats"),
    ("jobs", "job_configurations", "config_json"),
    ("jobs", "job_executions", "execution_log"),
    ("jobs", "job_executions", "detailed_logs"),
)


def upgrade() -> None:
    """Rewrite every stored `'null'::jsonb` as the SQL NULL it stood for.

    Counted on production before this was written: 22 rows, all of them
    `job_executions.detailed_logs`, a column whose two other absent rows were
    already SQL NULL. No row loses a document; nothing else here matches.
    """
    for schema, table, column in ABSENT_JSONB_COLUMNS:
        op.execute(
            f"UPDATE {schema}.{table} SET {column} = NULL "
            f"WHERE {column} = 'null'::jsonb"
        )


def downgrade() -> None:
    """Deliberately nothing.

    A row this revision emptied is indistinguishable from one written NULL by
    revision 0022 or by an `INSERT` that never named the column, so putting
    `'null'::jsonb` back would invent absences that were never stored that way.
    """
