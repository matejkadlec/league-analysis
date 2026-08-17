"""Drop the unused key counters and undo the doubled constraint names.

Revision ID: 20260817_0015
Revises: 20260816_0014
Create Date: 2026-08-17
"""

from __future__ import annotations

from alembic import op

revision = "20260817_0015"
down_revision = "20260816_0014"
branch_labels = None
depends_on = None

# `core.riot_api_keys.times_used` was never incremented by anything: no code
# path writes it, and all 27 production rows sit at 0 while its comment claims
# "Total number of requests made with this key". `last_used_at` is only
# marginally better — the settings save path stamps it, real request traffic
# never does, and no API response or screen reads either column. Wiring a
# counter into the client would mean a write per Riot call for a number nobody
# looks at, so the columns go instead.
DEAD_COLUMNS = ("last_used_at", "times_used")

# Revision 20260816_0012 passed names that already carried the `ck_<table>_`
# prefix into the `ck_%(table_name)s_%(constraint_name)s` convention, so the
# database ended up with `ck_players_ck_players_platform_is_lowercase` and its
# matches twin. `alembic check` cannot see it because the models spell the
# doubled name too — model and database agree on a wrong name.
DOUBLED_CONSTRAINTS = (
    ("players", "ck_players_ck_players_platform_is_lowercase"),
    ("matches", "ck_matches_ck_matches_platform_is_lowercase"),
)


def upgrade() -> None:
    """Drop the dead counters and rename both constraints to the convention."""
    for column in DEAD_COLUMNS:
        op.drop_column("riot_api_keys", column, schema="core")

    # A plain `op.create_check_constraint` would re-apply the convention on top
    # of the name and double it a second time, which is how this happened;
    # RENAME CONSTRAINT takes the literal name.
    for table, doubled in DOUBLED_CONSTRAINTS:
        op.execute(
            f"ALTER TABLE core.{table} "
            f"RENAME CONSTRAINT {doubled} TO ck_{table}_platform_is_lowercase"
        )


def downgrade() -> None:
    """Restore the doubled names and the columns, empty.

    The counters held no information worth preserving — one was always 0 and
    the other recorded key saves — so re-creating them is the whole of what can
    be undone.
    """
    for table, doubled in DOUBLED_CONSTRAINTS:
        op.execute(
            f"ALTER TABLE core.{table} "
            f"RENAME CONSTRAINT ck_{table}_platform_is_lowercase TO {doubled}"
        )

    op.execute(
        "ALTER TABLE core.riot_api_keys "
        "ADD COLUMN last_used_at timestamp with time zone"
    )
    op.execute(
        "ALTER TABLE core.riot_api_keys "
        "ADD COLUMN times_used bigint DEFAULT 0 NOT NULL"
    )
