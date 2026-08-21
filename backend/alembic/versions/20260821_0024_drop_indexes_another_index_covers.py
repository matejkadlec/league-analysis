"""Drop every index another index already covers.

Revision ID: 20260821_0024
Revises: 20260821_0023
Create Date: 2026-08-21
"""

from __future__ import annotations

from alembic import op

revision = "20260821_0024"
down_revision = "20260821_0023"
branch_labels = None
depends_on = None

# A btree on (a) is dead weight beside a btree on (a, b): PostgreSQL uses the
# composite for any predicate the single-column index could serve. The repo
# already says so in `matches/models.py`, `matches/participants.py` and
# `smurf_boost_detection/models.py`; these ten are the places that had not
# caught up, found by scanning `Base.metadata` rather than by reading.
#
# `core.player_leagues.idx_leagues_puuid_created` is the strongest case: it is
# the table's own primary key spelled again with DESC, which a btree serves by
# scanning backwards.
#
# `ix_matchmaking_analyses_created_at` is the one exception to the rule and is
# dropped on different grounds: `created_at` does not lead the primary key, so
# nothing covers it -- but all four queries that order by it also filter on
# `puuid` (matchmaking_analysis/service.py:243, 258, 309, 349), so the primary
# key serves every one of them and this index has never been used.
#
# Unique and partial indexes are excluded throughout: they carry a constraint,
# not just an access path.
DROPPED_INDEXES: tuple[tuple[str, str, str, str], ...] = (
    (
        "auth",
        "join_us_contact_submissions",
        "ix_join_us_contact_submissions_remote_ip",
        "CREATE INDEX ix_join_us_contact_submissions_remote_ip "
        "ON auth.join_us_contact_submissions USING btree (remote_ip)",
    ),
    (
        "auth",
        "users",
        "ix_users_is_active",
        "CREATE INDEX ix_users_is_active ON auth.users USING btree (is_active)",
    ),
    (
        "core",
        "match_participants",
        "ix_match_participants_champion_id",
        "CREATE INDEX ix_match_participants_champion_id "
        "ON core.match_participants USING btree (champion_id)",
    ),
    (
        "core",
        "match_participants",
        "ix_match_participants_team_id",
        "CREATE INDEX ix_match_participants_team_id "
        "ON core.match_participants USING btree (team_id)",
    ),
    (
        "core",
        "matchmaking_analyses",
        "idx_matchmaking_analyses_puuid",
        "CREATE INDEX idx_matchmaking_analyses_puuid "
        "ON core.matchmaking_analyses USING btree (puuid)",
    ),
    (
        "core",
        "matchmaking_analyses",
        "ix_matchmaking_analyses_created_at",
        "CREATE INDEX ix_matchmaking_analyses_created_at "
        "ON core.matchmaking_analyses USING btree (created_at)",
    ),
    (
        "core",
        "player_leagues",
        "idx_leagues_puuid_created",
        "CREATE INDEX idx_leagues_puuid_created "
        "ON core.player_leagues USING btree (puuid, created_at DESC)",
    ),
    (
        "core",
        "player_leagues",
        "ix_player_leagues_tier",
        "CREATE INDEX ix_player_leagues_tier ON core.player_leagues USING btree (tier)",
    ),
    (
        "jobs",
        "job_configurations",
        "ix_job_configurations_job_type",
        "CREATE INDEX ix_job_configurations_job_type "
        "ON jobs.job_configurations USING btree (job_type)",
    ),
    (
        "jobs",
        "job_executions",
        "ix_job_executions_job_config_id",
        "CREATE INDEX ix_job_executions_job_config_id "
        "ON jobs.job_executions USING btree (job_config_id)",
    ),
    (
        "jobs",
        "job_executions",
        "ix_job_executions_status",
        "CREATE INDEX ix_job_executions_status "
        "ON jobs.job_executions USING btree (status)",
    ),
)


def upgrade() -> None:
    """Drop the eleven redundant indexes."""
    for schema, table, name, _ddl in DROPPED_INDEXES:
        op.drop_index(name, table_name=table, schema=schema)


def downgrade() -> None:
    """Recreate them exactly, DESC included."""
    for _schema, _table, _name, ddl in DROPPED_INDEXES:
        op.execute(ddl)
