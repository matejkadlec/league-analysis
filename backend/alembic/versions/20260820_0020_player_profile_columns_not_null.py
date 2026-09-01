"""Make the two nullable player profile columns NOT NULL, as every writer is.

Revision ID: 20260820_0020
Revises: 20260820_0019
Create Date: 2026-08-20
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260820_0020"
down_revision = "20260820_0019"
branch_labels = None
depends_on = None

# `PlayerBase` has always declared `summoner_level: int` and
# `profile_icon_id: int` as required and non-null, so a single NULL row would
# turn every response carrying that player into a 500 -- the API promises a
# value the schema permits it not to have. The columns were nullable only
# because the initial schema made them so; nothing has written a NULL since.
#
# Every insert path supplies a value: `the participant-field resolution in players/identity.py` defaults
# them to 29 and 0, `players/service.py` writes the summoner payload, and
# `player_updater` refreshes both from Riot. Production agrees -- 30,582 player
# rows, zero NULLs in either column, checked before writing this.
#
# So the constraint is not new behaviour, it is the behaviour the writers and
# the response schema already have, finally stated where it can be enforced. A
# future insert that forgets one now fails loudly at write time instead of
# silently poisoning a read.


def upgrade() -> None:
    """State the non-null invariant the writers and the API already keep."""
    # Belt and braces: the counts were zero when this was written, but a row
    # inserted between then and the deploy must not fail the ALTER. These are
    # the same defaults `the participant-field resolution in players/identity.py` uses.
    op.execute(
        sa.text(
            "UPDATE core.players SET profile_icon_id = 29 WHERE profile_icon_id IS NULL"
        )
    )
    op.execute(
        sa.text(
            "UPDATE core.players SET summoner_level = 0 WHERE summoner_level IS NULL"
        )
    )
    op.alter_column(
        "players",
        "profile_icon_id",
        existing_type=sa.Integer(),
        nullable=False,
        schema="core",
    )
    op.alter_column(
        "players",
        "summoner_level",
        existing_type=sa.Integer(),
        nullable=False,
        schema="core",
    )


def downgrade() -> None:
    """Return both columns to the nullable shape revision 0019 had."""
    op.alter_column(
        "players",
        "summoner_level",
        existing_type=sa.Integer(),
        nullable=True,
        schema="core",
    )
    op.alter_column(
        "players",
        "profile_icon_id",
        existing_type=sa.Integer(),
        nullable=True,
        schema="core",
    )
