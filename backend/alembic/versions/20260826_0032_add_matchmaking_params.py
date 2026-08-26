"""Persist the parameters a matchmaking analysis run was started with.

Revision ID: 20260826_0032
Revises: 20260824_0031
Create Date: 2026-08-26
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "20260826_0032"
down_revision = "20260824_0031"
branch_labels = None
depends_on = None

# Runs are no longer all "last 10 matches": the spine size and an optional
# end date are user-chosen, the resumed worker re-reads them from the row
# (a restarted process has no request payload), and the history Type column
# displays them. The server default backfills every legacy row with
# {match_count: 10, end_date: null} -- truthful, every pre-column run was one
# -- and NOT NULL keeps the schema alignment guard honest: no response field
# has to admit a None this column can no longer deliver.


def upgrade() -> None:
    op.add_column(
        "matchmaking_analyses",
        sa.Column(
            "params",
            JSONB(),
            nullable=False,
            server_default='{"match_count": 10, "end_date": null}',
            comment="Run parameters as JSON: {match_count, end_date}",
        ),
        schema="core",
    )


def downgrade() -> None:
    op.drop_column("matchmaking_analyses", "params", schema="core")
