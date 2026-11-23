"""Follow Riot's platform list: add ME1, retire PH2 and TH2 into SG2.

Revision ID: 20261123_0037
Revises: 20261123_0036
Create Date: 2026-11-23
"""

from __future__ import annotations

import sqlalchemy as sa
import structlog
from alembic import op

revision = "20261123_0037"
down_revision = "20261123_0036"
branch_labels = None
depends_on = None

logger = structlog.get_logger(__name__)

# Riot merged PH2 and TH2 into SG2 on 2025-01-08 and removed their hosts; ME1
# is live on the `europe` route (LGA-114). Rendered from `Platform`:
# `tests/test_riot_vocabulary.py` holds this string to the enum.
PLATFORM_SQL = (
    "platform IN ('br1', 'eun1', 'euw1', 'jp1', 'kr', 'la1', 'la2', "
    "'me1', 'na1', 'oc1', 'ru', 'sg2', 'tr1', 'tw2', 'vn2')"
)
# The list revision `20260826_0033` created, which a downgrade restores.
PREVIOUS_PLATFORM_SQL = (
    "platform IN ('br1', 'eun1', 'euw1', 'jp1', 'kr', 'la1', 'la2', "
    "'na1', 'oc1', 'ph2', 'ru', 'sg2', 'th2', 'tr1', 'tw2', 'vn2')"
)

# Matches are moved too, not kept readable under a CHECK that depends on
# what each database happens to hold: the schema stays one list everywhere,
# the match id keeps its original `PH2_` / `TH2_` prefix, and `sea` serves
# both shards, so routing a stored match is unchanged. The PUUID survived the
# merge, so a player row moves with no other change. No row is expected: the
# Match Fetcher syncs only games since 2026-01-01, a year after the merge.
RETIRE_PLAYER_PLATFORMS = (
    "UPDATE core.players SET platform = 'sg2' WHERE platform IN ('ph2', 'th2')"
)
RETIRE_MATCH_PLATFORMS = (
    "UPDATE core.matches SET platform = 'sg2' WHERE platform IN ('ph2', 'th2')"
)

COUNT_ME1_ROWS = """
    SELECT (SELECT COUNT(*) FROM core.players WHERE platform = 'me1')
         + (SELECT COUNT(*) FROM core.matches WHERE platform = 'me1')
"""

TABLES = ("players", "matches")


def _replace_platform_checks(sql: str) -> None:
    # Bare names: the `ck` convention prefixes `ck_<table>_` itself.
    for table in TABLES:
        op.drop_constraint("platform_supported", table, type_="check", schema="core")
        op.create_check_constraint("platform_supported", table, sql, schema="core")


def upgrade() -> None:
    """Move retired-platform rows to SG2, then CHECK against the live list.

    Idempotent: a second run moves no row.
    """
    connection = op.get_bind()
    players = connection.execute(sa.text(RETIRE_PLAYER_PLATFORMS)).rowcount
    matches = connection.execute(sa.text(RETIRE_MATCH_PLATFORMS)).rowcount
    logger.info(
        "retired_riot_platforms_moved_to_sg2",
        player_rows=players,
        match_rows=matches,
    )
    _replace_platform_checks(PLATFORM_SQL)


def downgrade() -> None:
    """Restore the old list only while no ME1 row would violate it.

    Rows the upgrade moved to `sg2` stay there: `sg2` is valid under both.
    """
    me1_rows = op.get_bind().execute(sa.text(COUNT_ME1_ROWS)).scalar_one()
    if me1_rows:
        raise RuntimeError(
            "Cannot restore the platform list without ME1 while ME1 players "
            "or matches exist"
        )
    _replace_platform_checks(PREVIOUS_PLATFORM_SQL)
