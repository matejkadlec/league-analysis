"""Drop the participant identifier Riot itself replaced.

Revision ID: 20260821_0029
Revises: 20260821_0028
Create Date: 2026-08-21
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260821_0029"
down_revision = "20260821_0028"
branch_labels = None
depends_on = None

# `core.match_participants.summoner_id` is the encrypted summoner ID Riot
# retired in favour of PUUID: every endpoint this application calls takes a
# PUUID, and the column's own comment already called it legacy. The row that
# carries it carries `puuid` in the next column, so nothing is lost that the
# table does not still hold -- and nothing read it back, in the API, the jobs,
# the frontend or the parked playstyle package.
#
# Checked against production first: all 37,740 participant rows have both a
# `summoner_id` and a `puuid`, so the identity every reader wants is present
# on every row this drops a second identifier from.
#
# The downgrade cannot refill it. The value is per-player and per-dev-key, it
# is not derivable from anything stored, and Riot no longer serves it in the
# match payload for new matches -- so a re-fetch would not bring it back
# either. Re-adding the column empty is the honest downgrade.


def upgrade() -> None:
    op.drop_column("match_participants", "summoner_id", schema="core")


def downgrade() -> None:
    op.add_column(
        "match_participants",
        sa.Column(
            "summoner_id",
            sa.String(63),
            nullable=True,
            comment="Legacy Summoner ID",
        ),
        schema="core",
    )
