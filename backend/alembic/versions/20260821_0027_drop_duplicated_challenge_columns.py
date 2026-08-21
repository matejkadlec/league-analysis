"""Drop the challenge columns `advanced_stats` already holds.

Revision ID: 20260821_0027
Revises: 20260821_0026
Create Date: 2026-08-21
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260821_0027"
down_revision = "20260821_0026"
branch_labels = None
depends_on = None

# `core.match_participants.advanced_stats` stores Riot's `challenges` object
# verbatim. Fifteen columns were then filled by copying one key each out of
# that same object, and nothing read any of them back -- not the API, not the
# jobs, not the frontend, not the parked playstyle package (which reads the
# six challenge columns that survive here).
#
# Checked against production before dropping, over all 37,740 participant
# rows: no row has a NULL `advanced_stats`, no stored column value disagrees
# with its key in the blob, and every row whose key is absent has 0 in the
# column -- Riot simply omits a challenge that does not apply. So the values
# are not being deleted, only their second copy.
#
# A reader that wants one of these back has `advanced_int(advanced_stats,
# "skillshotsHit")` in `match_stats.py`, which is how the surviving objective
# counts already read the blob.
DROPPED_COLUMNS: tuple[tuple[str, sa.Column[object]], ...] = (
    ("max_kill_deficit", sa.Column("max_kill_deficit", sa.Integer())),
    (
        "damage_taken_on_team_percentage",
        sa.Column("damage_taken_on_team_percentage", sa.Numeric(5, 4)),
    ),
    ("roam_kills", sa.Column("roam_kills", sa.Integer())),
    (
        "enemy_jungle_monster_kills",
        sa.Column("enemy_jungle_monster_kills", sa.Integer()),
    ),
    ("turret_plates_taken", sa.Column("turret_plates_taken", sa.Integer())),
    ("ally_saves", sa.Column("ally_saves", sa.Integer())),
    (
        "survived_single_digit_hp_count",
        sa.Column("survived_single_digit_hp_count", sa.Integer()),
    ),
    ("skillshots_hit", sa.Column("skillshots_hit", sa.Integer())),
    ("skillshots_dodged", sa.Column("skillshots_dodged", sa.Integer())),
    ("enemy_immobilizations", sa.Column("enemy_immobilizations", sa.Integer())),
    ("kills_near_enemy_turret", sa.Column("kills_near_enemy_turret", sa.Integer())),
    (
        "takedowns_first_x_minutes",
        sa.Column("takedowns_first_x_minutes", sa.Integer()),
    ),
    ("buffs_stolen", sa.Column("buffs_stolen", sa.Integer())),
    (
        "laning_phase_gold_exp_advantage",
        sa.Column("laning_phase_gold_exp_advantage", sa.Integer()),
    ),
    ("max_cs_advantage", sa.Column("max_cs_advantage", sa.Integer())),
)

# The `challenges` key each column was copied from, so the downgrade can put
# the values back rather than leaving fifteen NULL columns behind.
SOURCE_KEYS: dict[str, str] = {
    "max_kill_deficit": "maxKillDeficit",
    "damage_taken_on_team_percentage": "damageTakenOnTeamPercentage",
    "roam_kills": "killsOnOtherLanesEarlyJungleAsLaner",
    "enemy_jungle_monster_kills": "enemyJungleMonsterKills",
    "turret_plates_taken": "turretPlatesTaken",
    "ally_saves": "saveAllyFromDeath",
    "survived_single_digit_hp_count": "survivedSingleDigitHpCount",
    "skillshots_hit": "skillshotsHit",
    "skillshots_dodged": "skillshotsDodged",
    "enemy_immobilizations": "enemyChampionImmobilizations",
    "kills_near_enemy_turret": "killsNearEnemyTurret",
    "takedowns_first_x_minutes": "takedownsFirstXMinutes",
    "buffs_stolen": "buffsStolen",
    "laning_phase_gold_exp_advantage": "earlyLaningPhaseGoldExpAdvantage",
    "max_cs_advantage": "maxCsAdvantageOnLaneOpponent",
}


def upgrade() -> None:
    for name, _column in DROPPED_COLUMNS:
        op.drop_column("match_participants", name, schema="core")


def downgrade() -> None:
    """Re-add the columns and refill them from the blob they were copied from."""
    for _name, column in DROPPED_COLUMNS:
        op.add_column("match_participants", column, schema="core")
    for name, key in SOURCE_KEYS.items():
        cast_type = (
            "numeric" if name == "damage_taken_on_team_percentage" else "integer"
        )
        op.execute(
            f"UPDATE core.match_participants "
            f"SET {name} = COALESCE((advanced_stats ->> '{key}')::{cast_type}, 0)"
        )
