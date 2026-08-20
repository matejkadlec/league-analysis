"""Drop the columns left behind by the #nl bypass and the pause rework.

Revision ID: 20260820_0016
Revises: 20260817_0015
Create Date: 2026-08-20
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260820_0016"
down_revision = "20260817_0015"
branch_labels = None
depends_on = None

# `auth.join_us_contact_submissions.is_test` recorded whether a submission had
# used the `#nl` suffix to skip the captcha, the 300-character minimum and the
# hourly per-IP limit. That bypass is gone, so nothing can write True again and
# the two rate-limit queries that filtered `is_test IS FALSE` now match every
# row by definition.
#
# `jobs.job_configurations.is_paused` stopped being the source of truth when
# pause state moved to the per-run in-memory registry in control.py: one shared
# database bit cannot describe a regular run and a test run paused
# independently. Every reader already goes through the runtime snapshot.
DEAD_COLUMNS = (
    (
        "join_us_contact_submissions",
        "auth",
        "is_test",
        "True when submission used #nl test bypass",
    ),
    (
        "job_configurations",
        "jobs",
        "is_paused",
        "Whether a currently running job execution is paused",
    ),
)


def upgrade() -> None:
    """Drop both dormant boolean columns."""
    for table, schema, column, _comment in DEAD_COLUMNS:
        op.drop_column(table, column, schema=schema)


def downgrade() -> None:
    """Recreate both columns as they were, comments included."""
    for table, schema, column, comment in DEAD_COLUMNS:
        op.add_column(
            table,
            sa.Column(
                column,
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
                comment=comment,
            ),
            schema=schema,
        )
