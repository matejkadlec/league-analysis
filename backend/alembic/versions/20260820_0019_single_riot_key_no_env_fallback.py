"""Keep one Riot key row and drop the environment-credential columns.

Revision ID: 20260820_0019
Revises: 20260820_0018
Create Date: 2026-08-20
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260820_0019"
down_revision = "20260820_0018"
branch_labels = None
depends_on = None

# Two decisions land together because each one makes the other's columns dead.
#
# `RIOT_API_KEY` was a fallback for when no database key existed. Production
# never used it: the key has been saved through Settings every day for a month
# (30 rows) and `RIOT_API_KEY_VERSION` was never even set, so the branch that
# needed `environment_generation` has never run there. That version variable
# existed only to give an environment key a non-secret identity -- database
# keys already have one, their row id -- so removing the fallback removes the
# whole `environment_generation` mechanism with it. With `env` gone, `source`
# holds one bit that `db_key_id IS NULL` already carries, so it goes too.
#
# Past keys are secrets with no diagnostic value, so the table keeps only the
# current one. That makes `is_active` permanently true and its index pointless.
# Deleting the inactive rows here is not cleanup: the new lookup drops the
# `is_active` filter and takes the newest row, and the old "reactivate an
# existing key" path could leave the effective key *older* than a deactivated
# one -- so leaving them would let a stale secret win on the next request.


def upgrade() -> None:
    """Collapse to the single active key and drop the environment columns."""
    # Order matters: the surviving key must be chosen before `is_active`
    # disappears, and `riot_credential_health.db_key_id` is ON DELETE SET NULL,
    # so anything this deletes that health points at would blank the binding.
    op.execute(
        sa.text(
            """
            DELETE FROM core.riot_api_keys
            WHERE id NOT IN (
                SELECT id FROM core.riot_api_keys
                WHERE is_active
                ORDER BY added_at DESC
                LIMIT 1
            )
            """
        )
    )
    op.drop_index(
        "idx_riot_api_keys_active_added", table_name="riot_api_keys", schema="core"
    )
    op.drop_column("riot_api_keys", "is_active", schema="core")

    op.drop_constraint(
        "valid_source", "riot_credential_health", schema="core", type_="check"
    )
    op.drop_column("riot_credential_health", "source", schema="core")
    op.drop_column("riot_credential_health", "environment_generation", schema="core")


def downgrade() -> None:
    """Restore the columns; deleted keys and their history are not recoverable."""
    op.add_column(
        "riot_credential_health",
        sa.Column("environment_generation", sa.String(length=72), nullable=True),
        schema="core",
    )
    op.add_column(
        "riot_credential_health",
        sa.Column("source", sa.String(length=8), nullable=True),
        schema="core",
    )
    # `source` was NOT NULL before revision 0019 removed it. The value is a
    # function of `db_key_id`, so it is reconstructed rather than guessed.
    op.execute(
        sa.text(
            """
            UPDATE core.riot_credential_health
            SET source = CASE WHEN db_key_id IS NULL THEN 'none' ELSE 'db' END
            """
        )
    )
    op.alter_column("riot_credential_health", "source", nullable=False, schema="core")
    op.create_check_constraint(
        "valid_source",
        "riot_credential_health",
        "source IN ('none', 'db', 'env')",
        schema="core",
    )

    # The `DEFAULT true` is kept rather than dropped after backfilling: the
    # baseline created the column with it (20260803_0001_initial_schema.sql),
    # so removing it would leave the downgraded schema drifting from the one
    # revision 0018 actually had.
    op.add_column(
        "riot_api_keys",
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
            comment="Whether this key is currently active and usable",
        ),
        schema="core",
    )
    op.create_index(
        "idx_riot_api_keys_active_added",
        "riot_api_keys",
        ["is_active", sa.text("added_at DESC")],
        schema="core",
    )
