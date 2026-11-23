"""Keep each finished participant sample of a matchmaking run with its progress.

Revision ID: 20261123_0036
Revises: 20261115_0035
Create Date: 2026-11-23
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "20261123_0036"
down_revision = "20261115_0035"
branch_labels = None
depends_on = None

# A run resumed after a restart kept its progress keys but lost the samples
# behind them, which lived in the dead worker's memory: it read every
# participant from Riot again while the bar already showed them done (LGA-129).
# Nullable and without a default: legacy rows and finished runs hold none, and
# the resumed worker re-reads any participant it has no sample for.


def upgrade() -> None:
    op.add_column(
        "matchmaking_analyses",
        sa.Column(
            "participant_samples",
            JSONB(),
            nullable=True,
            comment="Finished participant samples a resumed worker restores",
        ),
        schema="core",
    )


def downgrade() -> None:
    op.drop_column("matchmaking_analyses", "participant_samples", schema="core")
