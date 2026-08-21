"""Say which `is_tracked` the column means.

Revision ID: 20260821_0025
Revises: 20260821_0024
Create Date: 2026-08-21
"""

from __future__ import annotations

from alembic import op

revision = "20260821_0025"
down_revision = "20260821_0024"
branch_labels = None
depends_on = None

# `core.players.is_tracked` means "tracked by at least one user" -- it is the
# allowlist both writer jobs load. `PlayerResponse.is_tracked` means "tracked
# by *you*", and is computed per request from `auth.user_tracked_players`.
# Two different questions under one name, one of which is a column and the
# other a per-request answer, and `PlayerResponse.model_validate(player)`
# filled the second from the first: every call site had to remember to
# overwrite it afterwards, and a forgotten one leaked "somebody tracks this
# player" to a viewer who does not.
#
# Renaming the column is what makes that impossible rather than merely
# discouraged: nothing on the row answers to `is_tracked` any more, so the
# response field has to be supplied explicitly.


def upgrade() -> None:
    op.alter_column(
        "players",
        "is_tracked",
        new_column_name="is_tracked_by_anyone",
        schema="core",
    )
    op.execute(
        "ALTER INDEX core.ix_players_is_tracked "
        "RENAME TO ix_players_is_tracked_by_anyone"
    )


def downgrade() -> None:
    op.execute(
        "ALTER INDEX core.ix_players_is_tracked_by_anyone "
        "RENAME TO ix_players_is_tracked"
    )
    op.alter_column(
        "players",
        "is_tracked_by_anyone",
        new_column_name="is_tracked",
        schema="core",
    )
