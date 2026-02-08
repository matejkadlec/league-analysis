-- League Analysis Database Schema
-- Single Source of Truth
-- Generated: 2026-02-01

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

-- [schemas]

DROP SCHEMA IF EXISTS auth CASCADE;
DROP SCHEMA IF EXISTS core CASCADE;
DROP SCHEMA IF EXISTS jobs CASCADE;

CREATE SCHEMA auth;
CREATE SCHEMA core;
CREATE SCHEMA jobs;

-- [types]

CREATE TYPE jobs.job_status_enum AS ENUM (
    'PENDING',
    'RUNNING',
    'SUCCESS',
    'FAILED',
    'RATE_LIMITED'
);

CREATE TYPE jobs.job_type_enum AS ENUM (
    'MATCH_FETCHER',
    'PLAYER_UPDATER'
);

CREATE TYPE core.analysis_status_enum AS ENUM (
    'PENDING',
    'IN_PROGRESS',
    'COMPLETED',
    'FAILED',
    'CANCELLED'
);

CREATE TYPE auth.theme_enum AS ENUM (
    'LIGHT',
    'DARK'
);

SET default_tablespace = '';
SET default_table_access_method = heap;

-- ==================================================================
-- SCHEMA: auth
-- ==================================================================

-- [table] auth.users

CREATE SEQUENCE auth.users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE TABLE auth.users (
    id bigint DEFAULT nextval('auth.users_id_seq'::regclass) NOT NULL,
    email character varying(255) NOT NULL,
    password_hash text NOT NULL,
    display_name character varying(128) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    is_admin boolean DEFAULT false NOT NULL,
    email_verified boolean DEFAULT false NOT NULL,
    email_verified_at timestamp with time zone,
    last_login timestamp with time zone,
    riot_account_connected boolean DEFAULT false NOT NULL,
    puuid character varying(78),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER SEQUENCE auth.users_id_seq OWNED BY auth.users.id;

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT pk_users PRIMARY KEY (id);

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT uq_users_email UNIQUE (email);

CREATE INDEX idx_users_email_is_active ON auth.users USING btree (email, is_active);
CREATE INDEX idx_users_is_active_is_admin ON auth.users USING btree (is_active, is_admin);
CREATE INDEX ix_users_created_at ON auth.users USING btree (created_at);
CREATE INDEX ix_users_email ON auth.users USING btree (email);
CREATE INDEX ix_users_is_active ON auth.users USING btree (is_active);
CREATE INDEX ix_users_is_admin ON auth.users USING btree (is_admin);
CREATE INDEX ix_users_last_login ON auth.users USING btree (last_login);
CREATE INDEX ix_users_puuid ON auth.users USING btree (puuid) WHERE puuid IS NOT NULL;

-- [table] auth.user_settings

CREATE TABLE auth.user_settings (
    user_id bigint NOT NULL,
    theme auth.theme_enum DEFAULT 'DARK'::auth.theme_enum NOT NULL,
    save_playstyle_url boolean DEFAULT false NOT NULL,
    saved_playstyle_puuid character varying(78),
    save_matchmaking_url boolean DEFAULT false NOT NULL,
    saved_matchmaking_puuid character varying(78),
    default_platform character varying(4) DEFAULT 'eun1'::character varying,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY auth.user_settings
    ADD CONSTRAINT pk_user_settings PRIMARY KEY (user_id);

ALTER TABLE ONLY auth.user_settings
    ADD CONSTRAINT fk_user_settings_user_id FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- [table] auth.user_tracked_players

CREATE TABLE auth.user_tracked_players (
    user_id bigint NOT NULL,
    puuid character varying(78) NOT NULL,
    tracked_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY auth.user_tracked_players
    ADD CONSTRAINT pk_user_tracked_players PRIMARY KEY (user_id, puuid);

ALTER TABLE ONLY auth.user_tracked_players
    ADD CONSTRAINT fk_user_tracked_players_user_id FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX idx_user_tracked_players_puuid ON auth.user_tracked_players USING btree (puuid);

-- [trigger] auth.create_user_settings_on_user_insert
-- Automatically creates a user_settings record when a new user is inserted

CREATE OR REPLACE FUNCTION auth.create_user_settings()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO auth.user_settings (user_id)
    VALUES (NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_create_user_settings_after_user_insert
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION auth.create_user_settings();

-- ==================================================================
-- SCHEMA: core
-- ==================================================================

-- [table] core.players

CREATE TABLE core.players (
    puuid character varying(78) NOT NULL,
    game_name character varying(16) NOT NULL,
    tag_line character varying(5) NOT NULL,
    platform character varying(4) NOT NULL,
    profile_icon_id integer,
    summoner_level integer,
    is_tracked boolean NOT NULL,
    last_playstyle_analysis timestamp with time zone,
    last_matchmaking_analysis timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

COMMENT ON COLUMN core.players.is_tracked IS 'Derived global flag: TRUE when at least one user tracks this player.';

ALTER TABLE ONLY core.players
    ADD CONSTRAINT pk_players PRIMARY KEY (puuid);

-- [table] core.matches

CREATE TABLE core.matches (
    match_id character varying(20) NOT NULL,
    game_mode character varying(32) NOT NULL,
    game_type character varying(32) NOT NULL,
    queue_id integer NOT NULL,
    game_version character varying(32) NOT NULL,
    map_id integer NOT NULL,
    platform character varying(4) NOT NULL,
    game_start_timestamp bigint NOT NULL,
    game_end_timestamp bigint NOT NULL,
    game_duration integer NOT NULL,
    early_surrender boolean DEFAULT false NOT NULL,
    surrender boolean DEFAULT false NOT NULL,
    game_result character varying(32),
    fully_analyzed boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY core.matches
    ADD CONSTRAINT pk_matches PRIMARY KEY (match_id);

CREATE INDEX idx_matches_start_timestamp ON core.matches USING btree (game_start_timestamp DESC);
CREATE INDEX idx_matches_processed ON core.matches USING btree (fully_analyzed) WHERE fully_analyzed = FALSE;

-- [table] core.match_participants

CREATE TABLE core.match_participants (
    match_id character varying(20) NOT NULL,
    participant_id integer NOT NULL,
    puuid character varying(78) NOT NULL,
    game_name character varying(16) NOT NULL,
    tag_line character varying(5) NOT NULL,
    summoner_id character varying(63),
    profile_icon integer,
    summoner_level integer,
    team_id integer NOT NULL,
    team_position character varying(16) NOT NULL,
    champion_id integer NOT NULL,
    champion_name character varying(32) NOT NULL,
    champion_level integer NOT NULL,
    champion_transform integer DEFAULT 0,
    win boolean NOT NULL,
    remake boolean DEFAULT false NOT NULL,
    kills integer DEFAULT 0 NOT NULL,
    deaths integer DEFAULT 0 NOT NULL,
    assists integer DEFAULT 0 NOT NULL,
    kda numeric(5,2) GENERATED ALWAYS AS (
        CASE WHEN deaths = 0 THEN (kills + assists)::numeric 
             ELSE ROUND((kills + assists)::numeric / deaths, 2) 
        END
    ) STORED,
    largest_multi_kill integer DEFAULT 0,
    largest_killing_spree integer DEFAULT 0,
    first_blood_kill boolean DEFAULT false,
    first_tower_kill boolean DEFAULT false,
    total_damage_dealt integer DEFAULT 0,
    total_damage_dealt_to_champions integer DEFAULT 0,
    physical_damage_dealt_to_champions integer DEFAULT 0,
    magic_damage_dealt_to_champions integer DEFAULT 0,
    true_damage_dealt_to_champions integer DEFAULT 0,
    damage_dealt_to_objectives integer DEFAULT 0,
    damage_dealt_to_turrets integer DEFAULT 0,
    total_damage_taken integer DEFAULT 0,
    physical_damage_taken integer DEFAULT 0,
    magic_damage_taken integer DEFAULT 0,
    true_damage_taken integer DEFAULT 0,
    damage_self_mitigated integer DEFAULT 0,
    total_self_healing integer DEFAULT 0,
    total_healing integer DEFAULT 0,
    total_shielding integer DEFAULT 0,
    vision_score integer DEFAULT 0,
    wards_placed integer DEFAULT 0,
    wards_killed integer DEFAULT 0,
    vision_wards_placed integer DEFAULT 0,
    vision_wards_bought integer DEFAULT 0,
    total_minions_killed integer DEFAULT 0,
    neutral_minions_killed integer DEFAULT 0,
    gold_earned integer DEFAULT 0,
    gold_spent integer DEFAULT 0,
    item0 integer DEFAULT 0 NOT NULL,
    item1 integer DEFAULT 0 NOT NULL,
    item2 integer DEFAULT 0 NOT NULL,
    item3 integer DEFAULT 0 NOT NULL,
    item4 integer DEFAULT 0 NOT NULL,
    item5 integer DEFAULT 0 NOT NULL,
    trinket integer DEFAULT 0 NOT NULL,
    items_purchased integer DEFAULT 0,
    consumables_purchased integer DEFAULT 0,
    role_bound_item integer DEFAULT 0,
    summoner1_id integer,
    summoner1_casts integer DEFAULT 0,
    summoner2_id integer,
    summoner2_casts integer DEFAULT 0,
    turret_kills integer DEFAULT 0,
    inhibitor_kills integer DEFAULT 0,
    objectives_stolen integer DEFAULT 0,
    time_spent_dead integer DEFAULT 0,
    time_played integer DEFAULT 0,
    solo_kills                       INTEGER DEFAULT 0,
    gold_per_minute                  NUMERIC(10, 2) DEFAULT 0,
    vision_score_per_minute          NUMERIC(10, 2) DEFAULT 0,
    kill_participation               NUMERIC(5, 4) DEFAULT 0,
    max_kill_deficit                 INTEGER DEFAULT 0,
    team_damage_percentage           NUMERIC(5, 4) DEFAULT 0,
    damage_taken_on_team_percentage  NUMERIC(5, 4) DEFAULT 0,
    roam_kills                       INTEGER DEFAULT 0,
    enemy_jungle_monster_kills       INTEGER DEFAULT 0,
    turret_plates_taken              INTEGER DEFAULT 0,
    ally_saves                       INTEGER DEFAULT 0,
    survived_single_digit_hp_count   INTEGER DEFAULT 0,
    skillshots_hit                   INTEGER DEFAULT 0,
    skillshots_dodged                INTEGER DEFAULT 0,
    enemy_immobilizations            INTEGER DEFAULT 0,
    kills_near_enemy_turret          INTEGER DEFAULT 0,
    takedowns_first_x_minutes        INTEGER DEFAULT 0,
    buffs_stolen                     INTEGER DEFAULT 0,
    epic_monster_steals              INTEGER DEFAULT 0,
    laning_phase_gold_exp_advantage  INTEGER DEFAULT 0,
    max_cs_advantage                 INTEGER DEFAULT 0,
    runes jsonb,
    advanced_stats jsonb
);

ALTER TABLE ONLY core.match_participants
    ADD CONSTRAINT pk_match_participants PRIMARY KEY (match_id, participant_id);

ALTER TABLE ONLY core.match_participants
    ADD CONSTRAINT uq_match_participants_puuid_match UNIQUE (match_id, puuid);

CREATE INDEX idx_match_participants_puuid ON core.match_participants USING btree (puuid);
CREATE INDEX idx_match_participants_champion_id ON core.match_participants USING btree (champion_id);

COMMENT ON COLUMN core.match_participants.runes IS 'Full Perks/Runes JSON data structure.
Contains style selections, perks, var1-3 values.
Stored as JSONB to preserve the tree structure:
{ "primaryStyle": 8000, "subStyle": 8300, "statPerks": {...}, "styles": [...] }';

COMMENT ON COLUMN core.match_participants.advanced_stats IS 'Full Challenges JSON data structure from Riot API.
Contains granular stats like damagePerMinute, healFromMapSources, skillshotsDodged, etc.
Kept as full JSON to avoid frequent schema migrations when Riot adds new challenges.';

-- [table] core.matchmaking_analyses
-- Immutable table - new records are inserted for each analysis, never updated

CREATE TABLE core.matchmaking_analyses (
    puuid character varying(78) NOT NULL,
    results jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    puuid_progress jsonb DEFAULT '{}'::jsonb,
    requests_saved integer DEFAULT 0 NOT NULL,
    rate_limit_reset_at timestamp with time zone
);

COMMENT ON TABLE core.matchmaking_analyses IS 'Immutable matchmaking analysis results. New records inserted per analysis.';
COMMENT ON COLUMN core.matchmaking_analyses.puuid_progress IS 'Tracks analyzed PUUIDs: {"<puuid>": true/false} where true=fully analyzed';
COMMENT ON COLUMN core.matchmaking_analyses.requests_saved IS 'Number of API requests saved due to cached match data in database';
COMMENT ON COLUMN core.matchmaking_analyses.rate_limit_reset_at IS 'Timestamp when rate limit resets (NULL = not waiting)';

ALTER TABLE ONLY core.matchmaking_analyses
    ADD CONSTRAINT pk_matchmaking_analyses PRIMARY KEY (puuid, created_at);

CREATE INDEX idx_matchmaking_analyses_puuid ON core.matchmaking_analyses USING btree (puuid);
CREATE INDEX ix_matchmaking_analyses_created_at ON core.matchmaking_analyses USING btree (created_at DESC);

-- [table] core.playstyle_analyses

CREATE SEQUENCE core.playstyle_analyses_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE TABLE core.playstyle_analyses (
    id bigint DEFAULT nextval('core.playstyle_analyses_id_seq'::regclass) NOT NULL,
    puuid character varying(78) NOT NULL,
    status core.analysis_status_enum DEFAULT 'PENDING'::core.analysis_status_enum NOT NULL,
    tags jsonb DEFAULT '{}'::jsonb NOT NULL,
    summary_stats jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER SEQUENCE core.playstyle_analyses_id_seq OWNED BY core.playstyle_analyses.id;

ALTER TABLE ONLY core.playstyle_analyses
    ADD CONSTRAINT pk_playstyle_analyses PRIMARY KEY (id);

CREATE INDEX ix_core_playstyle_analyses_puuid ON core.playstyle_analyses USING btree (puuid);
CREATE INDEX ix_core_playstyle_analyses_status ON core.playstyle_analyses USING btree (status);

-- [table] core.player_leagues
-- Immutable league history table (snapshot per created_at)

CREATE TABLE core.player_leagues (
    puuid character varying(78) NOT NULL,
    league_id character varying(36) NOT NULL,
    queue_type character varying(32) NOT NULL,
    tier character varying(16) NOT NULL,
    rank character varying(4),
    league_points integer NOT NULL,
    wins integer NOT NULL,
    losses integer NOT NULL,
    veteran boolean DEFAULT false NOT NULL,
    inactive boolean DEFAULT false NOT NULL,
    fresh_blood boolean DEFAULT false NOT NULL,
    hot_streak boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX idx_leagues_puuid_queue ON core.player_leagues USING btree (puuid, queue_type);
CREATE INDEX idx_leagues_tier_lp ON core.player_leagues USING btree (tier, league_points);
CREATE INDEX idx_leagues_tier_rank ON core.player_leagues USING btree (tier, rank);
CREATE INDEX idx_leagues_puuid_created ON core.player_leagues USING btree (puuid, created_at DESC);
CREATE INDEX idx_leagues_league_id ON core.player_leagues USING btree (league_id);

-- [table] core.rate_limit_state
-- Central rate limit state for all Riot API components

CREATE SEQUENCE core.rate_limit_state_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE TABLE core.rate_limit_state (
    id integer DEFAULT nextval('core.rate_limit_state_id_seq'::regclass) NOT NULL,
    component character varying(50) NOT NULL,
    priority integer NOT NULL DEFAULT 3,
    requests_made integer NOT NULL DEFAULT 0,
    window_start timestamp with time zone NOT NULL DEFAULT now(),
    window_size_seconds integer NOT NULL DEFAULT 120,
    max_requests integer NOT NULL DEFAULT 100,
    is_waiting boolean NOT NULL DEFAULT false,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

COMMENT ON TABLE core.rate_limit_state IS 'Central rate limit state for all Riot API components';
COMMENT ON COLUMN core.rate_limit_state.component IS 'Component name: MATCH_FETCHER, PLAYER_UPDATER, MATCHMAKING_ANALYSIS';
COMMENT ON COLUMN core.rate_limit_state.priority IS 'Priority level: 1=highest (PLAYER_UPDATER), 2=medium (MATCH_FETCHER), 3=lowest (MATCHMAKING_ANALYSIS)';
COMMENT ON COLUMN core.rate_limit_state.requests_made IS 'Number of requests made in current window';
COMMENT ON COLUMN core.rate_limit_state.window_start IS 'Start time of current rate limit window';
COMMENT ON COLUMN core.rate_limit_state.window_size_seconds IS 'Size of rate limit window in seconds (Riot: 120s)';
COMMENT ON COLUMN core.rate_limit_state.max_requests IS 'Maximum requests per window (Riot dev: 100)';
COMMENT ON COLUMN core.rate_limit_state.is_waiting IS 'True if this component is waiting for higher priority components';

ALTER SEQUENCE core.rate_limit_state_id_seq OWNED BY core.rate_limit_state.id;

ALTER TABLE ONLY core.rate_limit_state
    ADD CONSTRAINT pk_rate_limit_state PRIMARY KEY (id);

ALTER TABLE ONLY core.rate_limit_state
    ADD CONSTRAINT uq_rate_limit_state_component UNIQUE (component);

CREATE INDEX idx_rate_limit_priority_waiting ON core.rate_limit_state USING btree (priority, is_waiting);

-- [table] core.riot_api_keys

CREATE SEQUENCE core.riot_api_keys_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE TABLE core.riot_api_keys (
    id integer DEFAULT nextval('core.riot_api_keys_id_seq'::regclass) NOT NULL,
    key_value character varying(42) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    added_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone,
    times_used bigint DEFAULT 0 NOT NULL,
    CONSTRAINT check_riot_key_format CHECK (((key_value)::text ~~ 'RGAPI-%'::text) AND (length((key_value)::text) = 42))
);

COMMENT ON TABLE core.riot_api_keys IS 'Storage for Riot API keys';

ALTER SEQUENCE core.riot_api_keys_id_seq OWNED BY core.riot_api_keys.id;

ALTER TABLE ONLY core.riot_api_keys
    ADD CONSTRAINT pk_riot_api_keys PRIMARY KEY (id);

ALTER TABLE ONLY core.riot_api_keys
    ADD CONSTRAINT uq_riot_api_keys_value UNIQUE (key_value);

CREATE INDEX idx_riot_api_keys_active_added ON core.riot_api_keys USING btree (is_active, added_at DESC);

-- ==================================================================
-- SCHEMA: jobs
-- ==================================================================

-- [table] jobs.job_configurations

CREATE SEQUENCE jobs.job_configurations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE TABLE jobs.job_configurations (
    id integer DEFAULT nextval('jobs.job_configurations_id_seq'::regclass) NOT NULL,
    job_type jobs.job_type_enum NOT NULL,
    name character varying(128) NOT NULL,
    description text,
    schedule character varying(256) NOT NULL,
    is_active boolean NOT NULL,
    config_json jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER SEQUENCE jobs.job_configurations_id_seq OWNED BY jobs.job_configurations.id;

ALTER TABLE ONLY jobs.job_configurations
    ADD CONSTRAINT pk_job_configurations PRIMARY KEY (id);

CREATE INDEX idx_job_config_type_active ON jobs.job_configurations USING btree (job_type, is_active);
CREATE INDEX ix_app_job_configurations_is_active ON jobs.job_configurations USING btree (is_active);
CREATE INDEX ix_app_job_configurations_job_type ON jobs.job_configurations USING btree (job_type);
CREATE UNIQUE INDEX ix_app_job_configurations_name ON jobs.job_configurations USING btree (name);

-- Default Jobs
INSERT INTO jobs.job_configurations (name, job_type, description, schedule, is_active)
VALUES ('Match Fetcher', 'MATCH_FETCHER', 'Fetches new matches and updates player''s match history and rank progression', '3600', true)
ON CONFLICT (name) DO NOTHING;

INSERT INTO jobs.job_configurations (name, job_type, description, schedule, is_active)
VALUES ('Player Updater', 'PLAYER_UPDATER', 'Fetches player info and updates player name, tag, icon and level', '86400', true)
ON CONFLICT (name) DO NOTHING;

-- [table] jobs.job_executions

CREATE SEQUENCE jobs.job_executions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE TABLE jobs.job_executions (
    id integer DEFAULT nextval('jobs.job_executions_id_seq'::regclass) NOT NULL,
    job_config_id integer NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    status jobs.job_status_enum NOT NULL,
    api_requests_made integer NOT NULL,
    records_created integer NOT NULL,
    records_updated integer NOT NULL,
    error_message text,
    execution_log jsonb,
    detailed_logs jsonb,
    triggered_by character varying(16) DEFAULT 'system' NOT NULL,
    has_api_key_error boolean DEFAULT false NOT NULL
);

ALTER SEQUENCE jobs.job_executions_id_seq OWNED BY jobs.job_executions.id;

ALTER TABLE ONLY jobs.job_executions
    ADD CONSTRAINT pk_job_executions PRIMARY KEY (id);

CREATE INDEX idx_job_execution_config_started ON jobs.job_executions USING btree (job_config_id, started_at DESC);
CREATE INDEX idx_job_execution_status_started ON jobs.job_executions USING btree (status, started_at DESC);
CREATE INDEX idx_job_executions_started_at ON jobs.job_executions USING btree (started_at DESC);
CREATE INDEX idx_job_executions_status ON jobs.job_executions USING btree (status);
CREATE INDEX ix_app_job_executions_completed_at ON jobs.job_executions USING btree (completed_at);
CREATE INDEX ix_app_job_executions_job_config_id ON jobs.job_executions USING btree (job_config_id);
CREATE INDEX ix_app_job_executions_started_at ON jobs.job_executions USING btree (started_at);
CREATE INDEX ix_app_job_executions_status ON jobs.job_executions USING btree (status);

-- [table] jobs.apscheduler_jobs

CREATE TABLE jobs.apscheduler_jobs (
    id character varying(191) NOT NULL,
    next_run_time double precision,
    job_state bytea NOT NULL
);

ALTER TABLE ONLY jobs.apscheduler_jobs
    ADD CONSTRAINT apscheduler_jobs_pkey PRIMARY KEY (id);

CREATE INDEX ix_apscheduler_jobs_next_run_time ON jobs.apscheduler_jobs USING btree (next_run_time);

-- ==================================================================
-- GLOBAL FOREIGN KEYS (Cross-table constraints)
-- ==================================================================

ALTER TABLE ONLY core.match_participants
    ADD CONSTRAINT fk_match_participants_match_id_matches FOREIGN KEY (match_id) REFERENCES core.matches(match_id) ON DELETE CASCADE;

ALTER TABLE ONLY core.match_participants
    ADD CONSTRAINT fk_match_participants_puuid_players FOREIGN KEY (puuid) REFERENCES core.players(puuid) ON DELETE CASCADE;

ALTER TABLE ONLY core.matchmaking_analyses
    ADD CONSTRAINT fk_matchmaking_analyses_puuid_players FOREIGN KEY (puuid) REFERENCES core.players(puuid) ON DELETE CASCADE;

ALTER TABLE ONLY core.playstyle_analyses
    ADD CONSTRAINT fk_playstyle_analyses_puuid_players FOREIGN KEY (puuid) REFERENCES core.players(puuid) ON DELETE CASCADE;

ALTER TABLE ONLY core.player_leagues
    ADD CONSTRAINT fk_player_leagues_puuid_players FOREIGN KEY (puuid) REFERENCES core.players(puuid) ON DELETE CASCADE;

ALTER TABLE ONLY jobs.job_executions
    ADD CONSTRAINT fk_job_executions_job_config_id_job_configurations FOREIGN KEY (job_config_id) REFERENCES jobs.job_configurations(id) ON DELETE CASCADE;

ALTER TABLE ONLY auth.user_tracked_players
    ADD CONSTRAINT fk_user_tracked_players_puuid_players FOREIGN KEY (puuid) REFERENCES core.players(puuid) ON DELETE CASCADE;
