"""The schedule column never accepted a cron expression; stop claiming it does.

Revision ID: 20260821_0023
Revises: 20260821_0022
Create Date: 2026-08-21
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260821_0023"
down_revision = "20260821_0022"
branch_labels = None
depends_on = None

# `_parse_interval_from_schedule` has only ever understood "60", "interval:60"
# and "60s" -- an operator following the comment and entering "0 */2 * * *"
# got a job that silently never scheduled. Comment only; no data changes.
# Both production rows hold a plain number ("900" and "86400").

_OLD = "Job schedule (cron expression or interval specification)"
_NEW = "Run interval: '60', 'interval:60' or '60s'"


def upgrade() -> None:
    """Replace the comment with the formats the code actually parses."""
    op.alter_column(
        "job_configurations",
        "schedule",
        existing_type=sa.String(256),
        existing_nullable=False,
        existing_comment=_OLD,
        comment=_NEW,
        schema="jobs",
    )


def downgrade() -> None:
    """Restore the previous comment."""
    op.alter_column(
        "job_configurations",
        "schedule",
        existing_type=sa.String(256),
        existing_nullable=False,
        existing_comment=_NEW,
        comment=_OLD,
        schema="jobs",
    )
