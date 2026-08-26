"""Close Riot vocabularies the models already treat as enums.

Revision ID: 20260826_0033
Revises: 20260826_0032
Create Date: 2026-08-26
"""

from __future__ import annotations

from alembic import op

revision = "20260826_0033"
down_revision = "20260826_0032"
branch_labels = None
depends_on = None

# Rendered from the Python vocabularies (`Platform`, `Tier`, `Division`,
# `LeagueQueueType`, `TeamPosition`, `TeamId`). Extending a member is a
# schema change: add it to the enum and replace the matching CHECK.

PLATFORM_SQL = (
    "platform IN ('br1', 'eun1', 'euw1', 'jp1', 'kr', 'la1', 'la2', "
    "'na1', 'oc1', 'ph2', 'ru', 'sg2', 'th2', 'tr1', 'tw2', 'vn2')"
)
TIER_SQL = (
    "tier IN ('IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', "
    "'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER')"
)
RANK_SQL = "rank IS NULL OR rank IN ('I', 'II', 'III', 'IV')"
QUEUE_TYPE_SQL = "queue_type IN ('RANKED_SOLO_5x5', 'RANKED_FLEX_SR')"
TEAM_ID_SQL = "team_id IN (100, 200)"
TEAM_POSITION_SQL = (
    "team_position IS NULL OR team_position IN "
    "('BOTTOM', 'JUNGLE', 'MIDDLE', 'TOP', 'UTILITY')"
)


def upgrade() -> None:
    """Fold unrecognised lanes to NULL, then let the database hold the line."""
    op.execute(
        """
        UPDATE core.match_participants
        SET team_position = NULL
        WHERE team_position IS NOT NULL
          AND team_position NOT IN
            ('BOTTOM', 'JUNGLE', 'MIDDLE', 'TOP', 'UTILITY')
        """
    )
    # Bare names: the `ck` convention prefixes `ck_<table>_` itself.
    op.create_check_constraint(
        "platform_supported",
        "players",
        PLATFORM_SQL,
        schema="core",
    )
    op.create_check_constraint(
        "platform_supported",
        "matches",
        PLATFORM_SQL,
        schema="core",
    )
    op.create_check_constraint(
        "tier_valid",
        "player_leagues",
        TIER_SQL,
        schema="core",
    )
    op.create_check_constraint(
        "rank_division_valid",
        "player_leagues",
        RANK_SQL,
        schema="core",
    )
    op.create_check_constraint(
        "queue_type_valid",
        "player_leagues",
        QUEUE_TYPE_SQL,
        schema="core",
    )
    op.create_check_constraint(
        "team_id_valid",
        "match_participants",
        TEAM_ID_SQL,
        schema="core",
    )
    op.create_check_constraint(
        "team_position_valid",
        "match_participants",
        TEAM_POSITION_SQL,
        schema="core",
    )


def downgrade() -> None:
    """Drop the new CHECKs. Folded lane values are not restored."""
    for table, constraint in (
        ("players", "platform_supported"),
        ("matches", "platform_supported"),
        ("player_leagues", "tier_valid"),
        ("player_leagues", "rank_division_valid"),
        ("player_leagues", "queue_type_valid"),
        ("match_participants", "team_id_valid"),
        ("match_participants", "team_position_valid"),
    ):
        op.drop_constraint(constraint, table, type_="check", schema="core")
