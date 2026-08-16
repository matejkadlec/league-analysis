"""Reconcile the migrated schema with the ORM models.

Revision ID: 20260816_0014
Revises: 20260816_0013
Create Date: 2026-08-16
"""

from __future__ import annotations

from alembic import op

revision = "20260816_0014"
down_revision = "20260816_0013"
branch_labels = None
depends_on = None

# `Base.metadata` was a second, hand-maintained description of this schema and
# had drifted from it in 284 places. The models were corrected wherever the
# database was right; this revision moves the database the rest of the way, so
# `alembic check` becomes usable and `alembic/metadata-drift.txt` can be deleted.

# Same index, different name. ALTER INDEX is instant and keeps the index usable
# throughout, so these are renamed rather than dropped and rebuilt. Only pairs
# whose compiled DDL is otherwise byte-identical appear here: a partial index and
# a full one on the same column are NOT a rename.
INDEX_RENAMES: tuple[tuple[str, str, str], ...] = (
    ("auth", "ix_users_created_at", "idx_users_created_at"),
    ("core", "idx_match_participants_champion_id", "ix_match_participants_champion_id"),
    ("core", "idx_match_participants_puuid", "ix_match_participants_puuid"),
    ("core", "ix_core_playstyle_analyses_status", "ix_playstyle_analyses_status"),
    ("jobs", "ix_app_job_configurations_is_active", "ix_job_configurations_is_active"),
    ("jobs", "ix_app_job_configurations_job_type", "ix_job_configurations_job_type"),
    ("jobs", "ix_app_job_configurations_name", "ix_job_configurations_name"),
    ("jobs", "ix_app_job_executions_completed_at", "ix_job_executions_completed_at"),
    ("jobs", "ix_app_job_executions_job_config_id", "ix_job_executions_job_config_id"),
    ("jobs", "ix_app_job_executions_started_at", "ix_job_executions_started_at"),
    ("jobs", "idx_job_executions_status", "ix_job_executions_status"),
)

# Indexes the database carries that no model declares, and that another index
# now supersedes. The exact `CREATE INDEX` is kept so the downgrade restores
# them faithfully -- two of these are DESC, which a naive rebuild would lose.
DROPPED_INDEXES: tuple[tuple[str, str, str, str], ...] = (
    (
        "auth",
        "users",
        "ix_users_email",
        "CREATE INDEX ix_users_email ON auth.users USING btree (email)",
    ),
    (
        "core",
        "matches",
        "idx_matches_start_timestamp",
        "CREATE INDEX idx_matches_start_timestamp ON core.matches USING btree (game_start_timestamp DESC)",
    ),
    (
        "core",
        "matchmaking_analyses",
        "ix_app_matchmaking_analyses_puuid",
        "CREATE INDEX ix_app_matchmaking_analyses_puuid ON core.matchmaking_analyses USING btree (puuid)",
    ),
    (
        "core",
        "playstyle_analyses",
        "ix_core_playstyle_analyses_puuid",
        "CREATE INDEX ix_core_playstyle_analyses_puuid ON core.playstyle_analyses USING btree (puuid)",
    ),
    (
        "jobs",
        "job_executions",
        "idx_job_executions_started_at",
        "CREATE INDEX idx_job_executions_started_at ON jobs.job_executions USING btree (started_at DESC)",
    ),
    (
        "jobs",
        "job_executions",
        "ix_app_job_executions_status",
        "CREATE INDEX ix_app_job_executions_status ON jobs.job_executions USING btree (status)",
    ),
)

# Nullable in the database, non-optional in the models. Production holds zero
# NULLs in all of these across 37,390 rows, so no backfill is needed.
NOT_NULL_COLUMNS: tuple[str, ...] = (
    "damage_dealt_to_objectives",
    "damage_dealt_to_turrets",
    "damage_self_mitigated",
    "gold_earned",
    "gold_spent",
    "magic_damage_dealt_to_champions",
    "magic_damage_taken",
    "neutral_minions_killed",
    "physical_damage_dealt_to_champions",
    "physical_damage_taken",
    "total_damage_dealt",
    "total_damage_dealt_to_champions",
    "total_damage_taken",
    "total_healing",
    "total_minions_killed",
    "total_self_healing",
    "total_shielding",
    "true_damage_dealt_to_champions",
    "true_damage_taken",
    "vision_score",
    "vision_wards_bought",
    "vision_wards_placed",
    "wards_killed",
    "wards_placed",
)

# (schema, table, column, comment the model declares, comment the database had).
# The last element is usually None, but seven columns already carried a comment
# that the models word differently -- the downgrade has to put those back.
COLUMN_COMMENTS: tuple[tuple[str, str, str, str, str | None], ...] = (
    (
        "auth",
        "email_change_requests",
        "code_expires_at",
        "Verification code expiration timestamp",
        None,
    ),
    (
        "auth",
        "email_change_requests",
        "created_at",
        "When this request record was created",
        None,
    ),
    (
        "auth",
        "email_change_requests",
        "failed_attempts",
        "Consecutive failed verification attempts for current code",
        None,
    ),
    (
        "auth",
        "email_change_requests",
        "locked_until",
        "Email-change lock expiration after too many failed attempts",
        None,
    ),
    (
        "auth",
        "email_change_requests",
        "pending_email",
        "Unverified target email awaiting code confirmation",
        None,
    ),
    (
        "auth",
        "email_change_requests",
        "updated_at",
        "When this request record was last updated",
        None,
    ),
    ("auth", "email_change_requests", "user_id", "Reference to auth.users.id", None),
    (
        "auth",
        "email_change_requests",
        "verification_code_hash",
        "SHA-256 hash of the 6-digit verification code",
        None,
    ),
    (
        "auth",
        "join_us_contact_submissions",
        "id",
        "Auto-incrementing primary key",
        None,
    ),
    (
        "auth",
        "join_us_contact_submissions",
        "is_test",
        "True when submission used #nl test bypass",
        None,
    ),
    (
        "auth",
        "join_us_contact_submissions",
        "remote_ip",
        "Request source IP address",
        None,
    ),
    ("auth", "join_us_contact_submissions", "subject", "Submitted subject value", None),
    (
        "auth",
        "join_us_contact_submissions",
        "submitted_at",
        "When the submission was accepted",
        None,
    ),
    (
        "auth",
        "refresh_tokens",
        "created_from_ip",
        "Source IP address when token was created",
        None,
    ),
    (
        "auth",
        "refresh_tokens",
        "expires_at",
        "Refresh token expiration timestamp",
        None,
    ),
    ("auth", "refresh_tokens", "id", "Auto-incrementing primary key", None),
    ("auth", "refresh_tokens", "issued_at", "When the refresh token was issued", None),
    (
        "auth",
        "refresh_tokens",
        "replaced_by_token_id",
        "Token ID that replaced this token during rotation",
        None,
    ),
    (
        "auth",
        "refresh_tokens",
        "revoked_at",
        "When token was revoked (NULL means active)",
        None,
    ),
    (
        "auth",
        "refresh_tokens",
        "token_hash",
        "SHA-256 hash of the raw refresh token",
        None,
    ),
    (
        "auth",
        "refresh_tokens",
        "token_id",
        "Public token identifier (JWT-style jti equivalent)",
        None,
    ),
    (
        "auth",
        "refresh_tokens",
        "user_agent",
        "Request user-agent when token was created",
        None,
    ),
    ("auth", "refresh_tokens", "user_id", "Reference to auth.users.id", None),
    (
        "auth",
        "revoked_access_tokens",
        "expires_at",
        "Original token expiration timestamp",
        None,
    ),
    ("auth", "revoked_access_tokens", "id", "Auto-incrementing primary key", None),
    (
        "auth",
        "revoked_access_tokens",
        "reason",
        "Reason for revocation (logout, admin, security, etc.)",
        None,
    ),
    ("auth", "revoked_access_tokens", "revoked_at", "When the token was revoked", None),
    (
        "auth",
        "revoked_access_tokens",
        "token_id",
        "Revoked access token identifier (jti)",
        None,
    ),
    ("auth", "revoked_access_tokens", "user_id", "Reference to auth.users.id", None),
    (
        "auth",
        "subject_counts",
        "beta_tester",
        "How many Beta Tester contact emails have been submitted",
        None,
    ),
    (
        "auth",
        "subject_counts",
        "full_stack_developer",
        "How many Full-Stack Developer contact emails have been submitted",
        None,
    ),
    ("auth", "subject_counts", "id", "Singleton row identifier (always 1)", None),
    (
        "auth",
        "subject_counts",
        "other",
        "How many Other contact emails have been submitted",
        None,
    ),
    (
        "auth",
        "user_cookie_consents",
        "consent_level",
        "Consent level chosen by the user on this browser",
        None,
    ),
    (
        "auth",
        "user_cookie_consents",
        "consent_source",
        "Source of consent capture (banner, settings, etc.)",
        None,
    ),
    (
        "auth",
        "user_cookie_consents",
        "consent_version",
        "Cookie policy/version identifier used when consent was captured",
        None,
    ),
    (
        "auth",
        "user_cookie_consents",
        "consented_at",
        "When cookie consent was last explicitly set",
        None,
    ),
    (
        "auth",
        "user_cookie_consents",
        "updated_at",
        "When this consent record was last updated",
        None,
    ),
    (
        "auth",
        "user_cookie_consents",
        "user_id",
        "Reference to the user who submitted cookie consent",
        None,
    ),
    ("auth", "user_settings", "created_at", "When these settings were created", None),
    (
        "auth",
        "user_settings",
        "updated_at",
        "When these settings were last updated",
        None,
    ),
    ("auth", "user_settings", "user_id", "Reference to the user", None),
    ("auth", "user_tracked_players", "puuid", "Tracked player PUUID", None),
    (
        "auth",
        "user_tracked_players",
        "tracked_at",
        "When this player was added to the user's tracked list",
        None,
    ),
    ("auth", "user_tracked_players", "user_id", "User who tracks the player", None),
    ("auth", "users", "created_at", "When this user account was created", None),
    ("auth", "users", "display_name", "Display name shown in UI", None),
    ("auth", "users", "email", "User email address (unique)", None),
    ("auth", "users", "email_verified", "Whether the email has been verified", None),
    ("auth", "users", "email_verified_at", "When the email was verified", None),
    (
        "auth",
        "users",
        "failed_login_attempts",
        "Consecutive failed login attempts since last successful login",
        None,
    ),
    ("auth", "users", "id", "Auto-incrementing primary key", None),
    (
        "auth",
        "users",
        "is_active",
        "Whether the account is active (not disabled)",
        None,
    ),
    ("auth", "users", "is_admin", "Whether the user has admin privileges", None),
    (
        "auth",
        "users",
        "last_failed_login",
        "When the most recent failed login happened",
        None,
    ),
    ("auth", "users", "last_login", "When the user last logged in", None),
    (
        "auth",
        "users",
        "locked_until",
        "Account lock expiration timestamp after too many failed logins",
        None,
    ),
    ("auth", "users", "password_hash", "Hashed password using Argon2id", None),
    ("auth", "users", "updated_at", "When this user account was last updated", None),
    (
        "core",
        "match_participants",
        "advanced_stats",
        "Full Challenges JSON",
        "Full Challenges JSON data structure from Riot API.\nContains granular stats like damagePerMinute, healFromMapSources, skillshotsDodged, etc.\nKept as full JSON to avoid frequent schema migrations when Riot adds new challenges.",
    ),
    ("core", "match_participants", "ally_saves", "saveAllyFromDeath", None),
    (
        "core",
        "match_participants",
        "enemy_immobilizations",
        "enemyChampionImmobilizations",
        None,
    ),
    ("core", "match_participants", "game_name", "Player's game name", None),
    ("core", "match_participants", "match_id", "Reference to the match", None),
    ("core", "match_participants", "participant_id", "Participant ID (1-10)", None),
    (
        "core",
        "match_participants",
        "puuid",
        "Reference to the player (Riot PUUID)",
        None,
    ),
    ("core", "match_participants", "remake", "Inverted eligibleForProgression", None),
    (
        "core",
        "match_participants",
        "roam_kills",
        "killsOnOtherLanesEarlyJungleAsLaner",
        None,
    ),
    (
        "core",
        "match_participants",
        "runes",
        "Full Runes JSON",
        'Full Perks/Runes JSON data structure.\nContains style selections, perks, var1-3 values.\nStored as JSONB to preserve the tree structure:\n{ "primaryStyle": 8000, "subStyle": 8300, "statPerks": {...}, "styles": [...] }',
    ),
    ("core", "match_participants", "summoner_id", "Legacy Summoner ID", None),
    ("core", "match_participants", "tag_line", "Player's tag Line", None),
    ("core", "match_participants", "team_id", "100 (Blue) or 200 (Red)", None),
    (
        "core",
        "match_participants",
        "team_position",
        "TOP, JUNGLE, MIDDLE, BOTTOM, UTILITY",
        None,
    ),
    (
        "core",
        "match_timelines",
        "objective_events",
        None,
        "Compact objective event log.\nEach object uses short keys: t=timestamp, o=objective, r=role(K/A), optional l=lane, s=subtype, m=monsterType.",
    ),
    (
        "core",
        "matches",
        "created_at",
        "When this match record was created in our database",
        None,
    ),
    (
        "core",
        "matches",
        "early_surrender",
        "Whether the game ended in early surrender",
        None,
    ),
    (
        "core",
        "matches",
        "fully_analyzed",
        "Whether this match has been processed for playstyle analysis",
        None,
    ),
    ("core", "matches", "game_duration", "Game duration in seconds", None),
    (
        "core",
        "matches",
        "game_end_timestamp",
        "Game end timestamp in milliseconds since epoch",
        None,
    ),
    ("core", "matches", "game_mode", "Game mode (e.g., 'CLASSIC', 'ARAM')", None),
    ("core", "matches", "game_result", "End of game result", None),
    (
        "core",
        "matches",
        "game_start_timestamp",
        "Actual game start, or creation time for explicitly marked legacy rows",
        "Actual Riot gameStartTimestamp, or gameCreation only when the source column marks a legacy fallback",
    ),
    (
        "core",
        "matches",
        "game_start_timestamp_source",
        "Source semantics for game_start_timestamp",
        "Whether game_start_timestamp is actual or a legacy fallback",
    ),
    ("core", "matches", "game_type", "Game type (e.g., 'MATCHED_GAME')", None),
    ("core", "matches", "game_version", "Game version (e.g., '14.20.555.5555')", None),
    ("core", "matches", "map_id", "Map ID (e.g., 11=Summoner's Rift)", None),
    ("core", "matches", "match_id", "Unique match identifier from Riot API", None),
    (
        "core",
        "matches",
        "platform",
        "Platform where the match was played, canonical lowercase (e.g. euw1)",
        None,
    ),
    (
        "core",
        "matches",
        "queue_id",
        "Queue type ID (e.g., 420=Ranked Solo, 440=Ranked Flex)",
        None,
    ),
    ("core", "matches", "surrender", "Whether the game ended in surrender", None),
    ("core", "matches", "updated_at", "When this match record was last updated", None),
    (
        "core",
        "matchmaking_analyses",
        "completed_at",
        "When this analysis was completed",
        None,
    ),
    (
        "core",
        "matchmaking_analyses",
        "created_at",
        "When this analysis was created",
        None,
    ),
    (
        "core",
        "matchmaking_analyses",
        "puuid",
        "Player PUUID this analysis is for",
        None,
    ),
    (
        "core",
        "matchmaking_analyses",
        "puuid_progress",
        "Tracks analyzed PUUIDs: {puuid: true/false}",
        None,
    ),
    (
        "core",
        "matchmaking_analyses",
        "rate_limit_reset_at",
        "Timestamp when rate limit resets (NULL = not waiting)",
        None,
    ),
    (
        "core",
        "matchmaking_analyses",
        "requests_saved",
        "Count of API requests saved from cached matches",
        None,
    ),
    (
        "core",
        "matchmaking_analyses",
        "results",
        "Analysis results as JSON (team/enemy winrates)",
        None,
    ),
    (
        "core",
        "matchmaking_analyses",
        "started_at",
        "When this analysis was started",
        None,
    ),
    (
        "core",
        "player_leagues",
        "created_at",
        "When this league snapshot was recorded",
        None,
    ),
    (
        "core",
        "player_leagues",
        "fresh_blood",
        "Whether player recently joined this tier",
        None,
    ),
    (
        "core",
        "player_leagues",
        "hot_streak",
        "Whether player is on a winning streak",
        None,
    ),
    (
        "core",
        "player_leagues",
        "inactive",
        "Whether player is inactive (decay warning)",
        None,
    ),
    ("core", "player_leagues", "league_points", "League points (0-100)", None),
    ("core", "player_leagues", "losses", "Number of losses in this queue", None),
    ("core", "player_leagues", "puuid", "Reference to the player (Riot PUUID)", None),
    (
        "core",
        "player_leagues",
        "queue_type",
        "Queue type (e.g., RANKED_SOLO_5x5, RANKED_FLEX_SR)",
        None,
    ),
    ("core", "player_leagues", "rank", "Rank division (I, II, III, IV)", None),
    (
        "core",
        "player_leagues",
        "tier",
        "Rank tier (e.g., GOLD, PLATINUM, DIAMOND)",
        None,
    ),
    (
        "core",
        "player_leagues",
        "veteran",
        "Whether player is a veteran (100+ games in this queue)",
        None,
    ),
    ("core", "player_leagues", "wins", "Number of wins in this queue", None),
    (
        "core",
        "players",
        "created_at",
        "When this player record was first created",
        None,
    ),
    ("core", "players", "game_name", "Player's game name", None),
    (
        "core",
        "players",
        "is_tracked",
        "Whether this player is tracked by at least one user for continuous updates",
        "Derived global flag: TRUE when at least one user tracks this player.",
    ),
    (
        "core",
        "players",
        "last_matchmaking_analysis",
        "Time of the last matchmaking analysis",
        None,
    ),
    (
        "core",
        "players",
        "last_playstyle_analysis",
        "Time of the last playstyle analysis",
        None,
    ),
    ("core", "players", "platform", "Platform, canonical lowercase (e.g. eun1)", None),
    ("core", "players", "profile_icon_id", "Profile icon ID", None),
    (
        "core",
        "players",
        "puuid",
        "Player's universally unique identifier from Riot API",
        None,
    ),
    ("core", "players", "summoner_level", "Summoner/Account level", None),
    ("core", "players", "tag_line", "Player's tag line", None),
    ("core", "players", "updated_at", "When this player record was last updated", None),
    ("core", "playstyle_analyses", "created_at", "Analysis creation time", None),
    ("core", "playstyle_analyses", "id", "Auto-incrementing primary key", None),
    (
        "core",
        "playstyle_analyses",
        "puuid",
        "Reference to the player being analyzed (Riot PUUID)",
        None,
    ),
    ("core", "playstyle_analyses", "status", "Current status of the analysis", None),
    (
        "core",
        "playstyle_analyses",
        "summary_stats",
        "Summary statistics calculated during analysis",
        None,
    ),
    (
        "core",
        "playstyle_analyses",
        "tags",
        "Detected playstyle tags (key=tag_code, value=details)",
        None,
    ),
    ("core", "playstyle_analyses", "updated_at", "Last update time", None),
    (
        "core",
        "rate_limit_state",
        "priority",
        "Priority level: 1=highest, 2=medium, 3=lowest",
        "Priority level: 1=highest (PLAYER_UPDATER), 2=medium (MATCH_FETCHER), 3=lowest (MATCHMAKING_ANALYSIS)",
    ),
    (
        "core",
        "riot_api_keys",
        "added_at",
        "When this key was added to the system",
        None,
    ),
    (
        "core",
        "riot_api_keys",
        "is_active",
        "Whether this key is currently active and usable",
        None,
    ),
    (
        "core",
        "riot_api_keys",
        "key_value",
        "The actual Riot API key (RGAPI-...) which must be 42 chars",
        None,
    ),
    (
        "core",
        "riot_api_keys",
        "last_used_at",
        "Last time this key was successfully used",
        None,
    ),
    (
        "core",
        "riot_api_keys",
        "times_used",
        "Total number of requests made with this key",
        None,
    ),
    (
        "core",
        "riot_credential_health",
        "environment_generation",
        "Explicit or runtime-random non-secret environment generation",
        None,
    ),
    (
        "jobs",
        "job_configurations",
        "config_json",
        "Job-specific configuration parameters in JSON format",
        None,
    ),
    (
        "jobs",
        "job_configurations",
        "created_at",
        "When this job configuration was created",
        None,
    ),
    (
        "jobs",
        "job_configurations",
        "description",
        "Description of what the job does",
        None,
    ),
    (
        "jobs",
        "job_configurations",
        "id",
        "Unique identifier for job configuration",
        None,
    ),
    (
        "jobs",
        "job_configurations",
        "is_active",
        "Whether this job is active and should be scheduled",
        None,
    ),
    (
        "jobs",
        "job_configurations",
        "is_paused",
        "Whether a currently running job execution is paused",
        None,
    ),
    (
        "jobs",
        "job_configurations",
        "job_type",
        "Type of job (match_fetcher, player_updater)",
        None,
    ),
    (
        "jobs",
        "job_configurations",
        "name",
        "Unique name for this job configuration",
        None,
    ),
    (
        "jobs",
        "job_configurations",
        "schedule",
        "Job schedule (cron expression or interval specification)",
        None,
    ),
    (
        "jobs",
        "job_configurations",
        "updated_at",
        "When this job configuration was last updated",
        None,
    ),
    (
        "jobs",
        "job_executions",
        "api_requests_made",
        "Number of API requests made during this execution",
        None,
    ),
    (
        "jobs",
        "job_executions",
        "completed_at",
        "When this job execution completed",
        None,
    ),
    (
        "jobs",
        "job_executions",
        "detailed_logs",
        "All logs captured during job execution (INFO, WARNING, ERROR, etc.)",
        None,
    ),
    (
        "jobs",
        "job_executions",
        "error_message",
        "Error message if job execution failed",
        None,
    ),
    (
        "jobs",
        "job_executions",
        "execution_log",
        "Detailed execution log and metrics in JSON format",
        None,
    ),
    (
        "jobs",
        "job_executions",
        "execution_type",
        "Type of execution: REGULAR (normal run) or TEST (API health-check run)",
        None,
    ),
    (
        "jobs",
        "job_executions",
        "has_api_key_error",
        "Whether this execution encountered an API key authentication error",
        None,
    ),
    ("jobs", "job_executions", "id", "Unique identifier for job execution", None),
    (
        "jobs",
        "job_executions",
        "job_config_id",
        "Reference to the job configuration",
        None,
    ),
    (
        "jobs",
        "job_executions",
        "records_created",
        "Number of database records created during this execution",
        None,
    ),
    (
        "jobs",
        "job_executions",
        "records_updated",
        "Number of database records updated during this execution",
        None,
    ),
    ("jobs", "job_executions", "started_at", "When this job execution started", None),
    ("jobs", "job_executions", "status", "Current status of job execution", None),
    (
        "jobs",
        "job_executions",
        "triggered_by",
        "Who triggered the job execution: 'system' (scheduler) or 'user' (manual trigger)",
        None,
    ),
)


def upgrade() -> None:
    """Move the database to what the models describe."""
    for schema, old, new in INDEX_RENAMES:
        op.execute(f"ALTER INDEX {schema}.{old} RENAME TO {new}")

    for schema, table, name, _ddl in DROPPED_INDEXES:
        op.drop_index(name, table_name=table, schema=schema)

    op.drop_constraint(
        "uq_refresh_tokens_token_id", "refresh_tokens", schema="auth", type_="unique"
    )
    op.drop_constraint(
        "uq_revoked_access_tokens_token_id",
        "revoked_access_tokens",
        schema="auth",
        type_="unique",
    )
    op.drop_constraint("uq_users_email", "users", schema="auth", type_="unique")
    op.drop_constraint(
        "rate_limit_state_component_key",
        "rate_limit_state",
        schema="core",
        type_="unique",
    )
    op.drop_constraint(
        "uq_riot_api_keys_value", "riot_api_keys", schema="core", type_="unique"
    )

    op.create_index(
        "ix_refresh_tokens_token_id",
        "refresh_tokens",
        ["token_id"],
        unique=True,
        schema="auth",
    )
    op.create_index(
        "ix_refresh_tokens_user_id",
        "refresh_tokens",
        ["user_id"],
        unique=False,
        schema="auth",
    )
    op.create_index(
        "ix_revoked_access_tokens_expires_at",
        "revoked_access_tokens",
        ["expires_at"],
        unique=False,
        schema="auth",
    )
    op.create_index(
        "ix_revoked_access_tokens_token_id",
        "revoked_access_tokens",
        ["token_id"],
        unique=True,
        schema="auth",
    )
    op.create_index(
        "idx_users_last_login", "users", ["last_login"], unique=False, schema="auth"
    )
    op.create_index(
        "idx_users_locked_until", "users", ["locked_until"], unique=False, schema="auth"
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True, schema="auth")
    op.create_index(
        "idx_participants_champion_win",
        "match_participants",
        ["champion_id", "win"],
        unique=False,
        schema="core",
    )
    op.create_index(
        "idx_participants_kills_deaths",
        "match_participants",
        ["kills", "deaths"],
        unique=False,
        schema="core",
    )
    op.create_index(
        "idx_participants_match_puuid",
        "match_participants",
        ["match_id", "puuid"],
        unique=False,
        schema="core",
    )
    op.create_index(
        "idx_participants_position_champion",
        "match_participants",
        ["team_position", "champion_id"],
        unique=False,
        schema="core",
    )
    op.create_index(
        "idx_participants_team_win",
        "match_participants",
        ["team_id", "win"],
        unique=False,
        schema="core",
    )
    op.create_index(
        "ix_match_participants_match_id",
        "match_participants",
        ["match_id"],
        unique=False,
        schema="core",
    )
    op.create_index(
        "ix_match_participants_team_id",
        "match_participants",
        ["team_id"],
        unique=False,
        schema="core",
    )
    op.create_index(
        "idx_matches_analyzed_timestamp",
        "matches",
        ["fully_analyzed", "game_start_timestamp"],
        unique=False,
        schema="core",
    )
    op.create_index(
        "idx_matches_platform_timestamp",
        "matches",
        ["platform", "game_start_timestamp"],
        unique=False,
        schema="core",
    )
    op.create_index(
        "idx_matches_queue_timestamp",
        "matches",
        ["queue_id", "game_start_timestamp"],
        unique=False,
        schema="core",
    )
    op.create_index(
        "idx_matches_timestamp_queue",
        "matches",
        ["game_start_timestamp", "queue_id"],
        unique=False,
        schema="core",
    )
    op.create_index(
        "idx_matches_version_timestamp",
        "matches",
        ["game_version", "game_start_timestamp"],
        unique=False,
        schema="core",
    )
    op.create_index(
        "ix_matches_fully_analyzed",
        "matches",
        ["fully_analyzed"],
        unique=False,
        schema="core",
    )
    op.create_index(
        "ix_matches_game_mode", "matches", ["game_mode"], unique=False, schema="core"
    )
    op.create_index(
        "ix_matches_game_start_timestamp",
        "matches",
        ["game_start_timestamp"],
        unique=False,
        schema="core",
    )
    op.create_index(
        "ix_matches_game_type", "matches", ["game_type"], unique=False, schema="core"
    )
    op.create_index(
        "ix_matches_game_version",
        "matches",
        ["game_version"],
        unique=False,
        schema="core",
    )
    op.create_index(
        "ix_matches_match_id", "matches", ["match_id"], unique=False, schema="core"
    )
    op.create_index(
        "ix_matches_platform", "matches", ["platform"], unique=False, schema="core"
    )
    op.create_index(
        "ix_matches_queue_id", "matches", ["queue_id"], unique=False, schema="core"
    )
    op.create_index(
        "ix_player_leagues_league_id",
        "player_leagues",
        ["league_id"],
        unique=False,
        schema="core",
    )
    op.create_index(
        "ix_player_leagues_queue_type",
        "player_leagues",
        ["queue_type"],
        unique=False,
        schema="core",
    )
    op.create_index(
        "ix_player_leagues_rank",
        "player_leagues",
        ["rank"],
        unique=False,
        schema="core",
    )
    op.create_index(
        "ix_player_leagues_tier",
        "player_leagues",
        ["tier"],
        unique=False,
        schema="core",
    )
    op.create_index(
        "idx_players_game_name_tag_line",
        "players",
        ["game_name", "tag_line"],
        unique=False,
        schema="core",
    )
    op.create_index(
        "ix_players_game_name", "players", ["game_name"], unique=False, schema="core"
    )
    op.create_index(
        "ix_players_is_tracked", "players", ["is_tracked"], unique=False, schema="core"
    )
    op.create_index(
        "ix_players_platform", "players", ["platform"], unique=False, schema="core"
    )
    op.create_index(
        "ix_players_puuid", "players", ["puuid"], unique=False, schema="core"
    )
    op.create_index(
        "ix_playstyle_analyses_puuid",
        "playstyle_analyses",
        ["puuid"],
        unique=True,
        schema="core",
    )

    op.create_unique_constraint(
        "uq_rate_limit_state_component",
        "rate_limit_state",
        ["component"],
        schema="core",
    )
    op.create_unique_constraint(
        "uq_riot_api_keys_key_value", "riot_api_keys", ["key_value"], schema="core"
    )

    for column in NOT_NULL_COLUMNS:
        op.alter_column("match_participants", column, nullable=False, schema="core")

    for schema, table, column, comment, existing in COLUMN_COMMENTS:
        op.alter_column(
            table, column, comment=comment, existing_comment=existing, schema=schema
        )


def downgrade() -> None:
    """Return the database to the pre-reconciliation shape."""
    for schema, table, column, comment, existing in COLUMN_COMMENTS:
        op.alter_column(
            table, column, comment=existing, existing_comment=comment, schema=schema
        )

    for column in NOT_NULL_COLUMNS:
        op.alter_column("match_participants", column, nullable=True, schema="core")

    op.drop_constraint(
        "uq_rate_limit_state_component",
        "rate_limit_state",
        schema="core",
        type_="unique",
    )
    op.drop_constraint(
        "uq_riot_api_keys_key_value", "riot_api_keys", schema="core", type_="unique"
    )
    op.drop_index(
        "ix_refresh_tokens_token_id", table_name="refresh_tokens", schema="auth"
    )
    op.drop_index(
        "ix_refresh_tokens_user_id", table_name="refresh_tokens", schema="auth"
    )
    op.drop_index(
        "ix_revoked_access_tokens_expires_at",
        table_name="revoked_access_tokens",
        schema="auth",
    )
    op.drop_index(
        "ix_revoked_access_tokens_token_id",
        table_name="revoked_access_tokens",
        schema="auth",
    )
    op.drop_index("idx_users_last_login", table_name="users", schema="auth")
    op.drop_index("idx_users_locked_until", table_name="users", schema="auth")
    op.drop_index("ix_users_email", table_name="users", schema="auth")
    op.drop_index(
        "idx_participants_champion_win", table_name="match_participants", schema="core"
    )
    op.drop_index(
        "idx_participants_kills_deaths", table_name="match_participants", schema="core"
    )
    op.drop_index(
        "idx_participants_match_puuid", table_name="match_participants", schema="core"
    )
    op.drop_index(
        "idx_participants_position_champion",
        table_name="match_participants",
        schema="core",
    )
    op.drop_index(
        "idx_participants_team_win", table_name="match_participants", schema="core"
    )
    op.drop_index(
        "ix_match_participants_match_id", table_name="match_participants", schema="core"
    )
    op.drop_index(
        "ix_match_participants_team_id", table_name="match_participants", schema="core"
    )
    op.drop_index("idx_matches_analyzed_timestamp", table_name="matches", schema="core")
    op.drop_index("idx_matches_platform_timestamp", table_name="matches", schema="core")
    op.drop_index("idx_matches_queue_timestamp", table_name="matches", schema="core")
    op.drop_index("idx_matches_timestamp_queue", table_name="matches", schema="core")
    op.drop_index("idx_matches_version_timestamp", table_name="matches", schema="core")
    op.drop_index("ix_matches_fully_analyzed", table_name="matches", schema="core")
    op.drop_index("ix_matches_game_mode", table_name="matches", schema="core")
    op.drop_index(
        "ix_matches_game_start_timestamp", table_name="matches", schema="core"
    )
    op.drop_index("ix_matches_game_type", table_name="matches", schema="core")
    op.drop_index("ix_matches_game_version", table_name="matches", schema="core")
    op.drop_index("ix_matches_match_id", table_name="matches", schema="core")
    op.drop_index("ix_matches_platform", table_name="matches", schema="core")
    op.drop_index("ix_matches_queue_id", table_name="matches", schema="core")
    op.drop_index(
        "ix_player_leagues_league_id", table_name="player_leagues", schema="core"
    )
    op.drop_index(
        "ix_player_leagues_queue_type", table_name="player_leagues", schema="core"
    )
    op.drop_index("ix_player_leagues_rank", table_name="player_leagues", schema="core")
    op.drop_index("ix_player_leagues_tier", table_name="player_leagues", schema="core")
    op.drop_index("idx_players_game_name_tag_line", table_name="players", schema="core")
    op.drop_index("ix_players_game_name", table_name="players", schema="core")
    op.drop_index("ix_players_is_tracked", table_name="players", schema="core")
    op.drop_index("ix_players_platform", table_name="players", schema="core")
    op.drop_index("ix_players_puuid", table_name="players", schema="core")
    op.drop_index(
        "ix_playstyle_analyses_puuid", table_name="playstyle_analyses", schema="core"
    )

    op.create_unique_constraint(
        "uq_refresh_tokens_token_id", "refresh_tokens", ["token_id"], schema="auth"
    )
    op.create_unique_constraint(
        "uq_revoked_access_tokens_token_id",
        "revoked_access_tokens",
        ["token_id"],
        schema="auth",
    )
    op.create_unique_constraint("uq_users_email", "users", ["email"], schema="auth")
    op.create_unique_constraint(
        "rate_limit_state_component_key",
        "rate_limit_state",
        ["component"],
        schema="core",
    )
    op.create_unique_constraint(
        "uq_riot_api_keys_value", "riot_api_keys", ["key_value"], schema="core"
    )

    for _schema, _table, _name, ddl in DROPPED_INDEXES:
        op.execute(ddl)

    for schema, old, new in reversed(INDEX_RENAMES):
        op.execute(f"ALTER INDEX {schema}.{new} RENAME TO {old}")
