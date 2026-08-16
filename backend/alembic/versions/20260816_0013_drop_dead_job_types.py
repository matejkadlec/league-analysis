"""Drop the three job types no code declares any more.

Revision ID: 20260816_0013
Revises: 20260816_0012
Create Date: 2026-08-16
"""

from __future__ import annotations

from alembic import op

revision = "20260816_0013"
down_revision = "20260816_0012"
branch_labels = None
depends_on = None

# `jobs.job_type_enum` still carried TRACKED_PLAYER_UPDATER, PLAYER_ANALYZER
# and BAN_CHECKER after the simplification campaign deleted the jobs that used
# them, so the database offered three states `JobType` cannot express and no
# runner would accept. `jobs.job_configurations.job_type` is the only column of
# this type, and it holds two rows — MATCH_FETCHER and PLAYER_UPDATER — so
# nothing has to be migrated, only the type narrowed.
#
# PostgreSQL has no DROP VALUE for an enum at any version, so the type is
# rebuilt: rename the old one aside, create the narrowed one, move the column
# across with a cast, and drop the original. The rename-first order matters —
# creating `job_type_enum` while the old one still holds the name fails.
LIVE_LABELS = ("MATCH_FETCHER", "PLAYER_UPDATER")
RETIRED_LABELS = ("TRACKED_PLAYER_UPDATER", "PLAYER_ANALYZER", "BAN_CHECKER")


def _rebuild_enum(labels: tuple[str, ...]) -> None:
    """Replace `jobs.job_type_enum` with a type holding exactly `labels`."""
    values = ", ".join(f"'{label}'" for label in labels)
    op.execute("ALTER TYPE jobs.job_type_enum RENAME TO job_type_enum_old")
    op.execute(f"CREATE TYPE jobs.job_type_enum AS ENUM ({values})")
    op.execute(
        "ALTER TABLE jobs.job_configurations "
        "ALTER COLUMN job_type TYPE jobs.job_type_enum "
        "USING job_type::text::jobs.job_type_enum"
    )
    op.execute("DROP TYPE jobs.job_type_enum_old")


def upgrade() -> None:
    """Narrow the type to the two job types that still exist."""
    # A row carrying a retired type would be unrunnable rather than merely
    # untyped, and the USING cast below would fail on it anyway with a message
    # that names the cast instead of the data. Say which rows are wrong.
    # The message carries no `%` placeholder on purpose: `op.execute` sends
    # this through SQLAlchemy, which escapes `%` to `%%`, and PL/pgSQL then
    # reads the format string as having no parameters and rejects the argument
    # with "too many parameters specified for RAISE".
    retired = ", ".join(f"'{label}'" for label in RETIRED_LABELS)
    op.execute(
        "DO $$ "
        "BEGIN "
        "  IF EXISTS ( "
        "    SELECT 1 FROM jobs.job_configurations "
        f"    WHERE job_type::text IN ({retired}) "
        "  ) THEN "
        "    RAISE EXCEPTION 'jobs.job_configurations still holds rows of a "
        "retired job type; delete or retype them before migrating'; "
        "  END IF; "
        "END $$"
    )
    _rebuild_enum(LIVE_LABELS)


def downgrade() -> None:
    """Restore the retired labels, in their original declaration order."""
    _rebuild_enum(
        (
            "TRACKED_PLAYER_UPDATER",
            "MATCH_FETCHER",
            "PLAYER_UPDATER",
            "PLAYER_ANALYZER",
            "BAN_CHECKER",
        )
    )
