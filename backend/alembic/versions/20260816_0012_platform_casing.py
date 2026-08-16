"""Make platform casing canonical and enforce it.

Revision ID: 20260816_0012
Revises: 20260815_0011
Create Date: 2026-08-16
"""

from __future__ import annotations

from alembic import op

revision = "20260816_0012"
down_revision = "20260815_0011"
branch_labels = None
depends_on = None

# `core.players.platform` had five writers and they did not agree: the
# match-participant paths stored `.lower()`, player discovery stored
# `.upper()`, and a profile refresh stored the `Platform` enum's value, which
# is lowercase. Meanwhile `get_player_by_name_and_tag` and
# `get_player_by_game_name` compared the column case-sensitively against an
# uppercased argument, so any player whose row was created by a match sync was
# invisible to both lookups. Two other read paths had already been patched
# around it individually, one with `ilike` and one with `lower()`.
#
# Lowercase wins because it is Riot's own spelling: it is what the `Platform`
# enum holds and what every Riot URL uses. `core.matches.platform` was
# internally consistent at uppercase, but it is normalised too — two columns
# with the same name and different casing is a comparison bug waiting to be
# written.
TARGETS = (
    ("players", "ck_players_platform_is_lowercase"),
    ("matches", "ck_matches_platform_is_lowercase"),
)


def upgrade() -> None:
    """Fold existing rows to lowercase, then let the database hold the line."""
    for table, constraint in TARGETS:
        # Touch only the rows that are actually wrong, so the rewrite is
        # proportional to the damage rather than to the table.
        op.execute(
            f"UPDATE core.{table} SET platform = lower(platform) "
            f"WHERE platform <> lower(platform)"
        )
        op.create_check_constraint(
            constraint,
            table,
            "platform = lower(platform)",
            schema="core",
        )


def downgrade() -> None:
    """Drop the constraints.

    The original casing is not recoverable: which rows were uppercase depended
    on which code path first saw each player, and that is exactly the
    information this migration destroys. Restoring the constraint-free state is
    the whole of what can honestly be undone.
    """
    for table, constraint in TARGETS:
        op.drop_constraint(constraint, table, type_="check", schema="core")
