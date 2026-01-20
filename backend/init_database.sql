-- League Analysis Database Schema
-- Single Source of Truth
-- Generated: 2026-01-20

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
    'TRACKED_PLAYER_UPDATER',
    'MATCH_FETCHER',
    'PLAYER_ANALYZER',
    'BAN_CHECKER'
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

-- ==================================================================
-- SCHEMA: core
-- ==================================================================

-- [table] core.players

CREATE SEQUENCE core.players_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE TABLE core.players (
    id bigint DEFAULT nextval('core.players_id_seq'::regclass) NOT NULL,
    puuid character varying(78) NOT NULL,
    game_name character varying(64),
    tag_line character varying(8),
    region character varying(16) NOT NULL,
    profile_icon_id integer,
    summoner_level integer,
    is_tracked boolean NOT NULL,
    matches_analyzed integer DEFAULT 0 NOT NULL,
    last_player_analysis timestamp with time zone,
    last_matchmaking_analysis timestamp with time zone,
    fully_analyzed boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER SEQUENCE core.players_id_seq OWNED BY core.players.id;

-- PK is on puuid as per schema design (natural key)
ALTER TABLE ONLY core.players
    ADD CONSTRAINT pk_players PRIMARY KEY (puuid);

-- [table] core.matches

CREATE TABLE core.matches (
    match_id character varying(64) NOT NULL,
    platform_id character varying(8) NOT NULL,
    game_creation bigint NOT NULL,
    game_duration integer NOT NULL,
    queue_id integer NOT NULL,
    game_version character varying(32) NOT NULL,
    map_id integer NOT NULL,
    game_mode character varying(32),
    game_type character varying(32),
    game_end_timestamp bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tournament_id character varying(64),
    is_processed boolean NOT NULL,
    processing_error character varying(256)
);

ALTER TABLE ONLY core.matches
    ADD CONSTRAINT pk_matches PRIMARY KEY (match_id);

CREATE INDEX idx_matches_creation_queue ON core.matches USING btree (game_creation, queue_id);
CREATE INDEX idx_matches_match_id ON core.matches USING btree (match_id);
CREATE INDEX idx_matches_platform_creation ON core.matches USING btree (platform_id, game_creation);
CREATE INDEX idx_matches_processed_creation ON core.matches USING btree (is_processed, game_creation);
CREATE INDEX idx_matches_processed_error ON core.matches USING btree (is_processed, processing_error);
CREATE INDEX idx_matches_queue_creation ON core.matches USING btree (queue_id, game_creation);
CREATE INDEX idx_matches_version_creation ON core.matches USING btree (game_version, game_creation);
CREATE INDEX ix_app_matches_game_creation ON core.matches USING btree (game_creation);
CREATE INDEX ix_app_matches_game_mode ON core.matches USING btree (game_mode);
CREATE INDEX ix_app_matches_game_type ON core.matches USING btree (game_type);
CREATE INDEX ix_app_matches_game_version ON core.matches USING btree (game_version);
CREATE INDEX ix_app_matches_is_processed ON core.matches USING btree (is_processed);
CREATE INDEX ix_app_matches_match_id ON core.matches USING btree (match_id);
CREATE INDEX ix_app_matches_platform_id ON core.matches USING btree (platform_id);
CREATE INDEX ix_app_matches_queue_id ON core.matches USING btree (queue_id);
CREATE INDEX ix_app_matches_tournament_id ON core.matches USING btree (tournament_id);

-- [table] core.match_participants

CREATE SEQUENCE core.match_participants_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE TABLE core.match_participants (
    id bigint DEFAULT nextval('core.match_participants_id_seq'::regclass) NOT NULL,
    match_id character varying(64) NOT NULL,
    puuid character varying(78) NOT NULL,
    summoner_name character varying(32),
    summoner_level integer NOT NULL,
    team_id integer NOT NULL,
    champion_id integer NOT NULL,
    champion_name character varying(32) NOT NULL,
    kills integer NOT NULL,
    deaths integer NOT NULL,
    assists integer NOT NULL,
    win boolean NOT NULL,
    gold_earned integer NOT NULL,
    vision_score integer NOT NULL,
    cs integer NOT NULL,
    kda numeric(5,2),
    champ_level integer NOT NULL,
    total_damage_dealt bigint NOT NULL,
    total_damage_dealt_to_champions bigint NOT NULL,
    total_damage_taken bigint NOT NULL,
    total_heal bigint NOT NULL,
    individual_position character varying(16),
    team_position character varying(16),
    role character varying(16),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    riot_id_name character varying(128),
    riot_id_tagline character varying(32)
);

ALTER SEQUENCE core.match_participants_id_seq OWNED BY core.match_participants.id;

ALTER TABLE ONLY core.match_participants
    ADD CONSTRAINT pk_match_participants PRIMARY KEY (id);

CREATE INDEX idx_match_participants_match_id ON core.match_participants USING btree (match_id);
CREATE INDEX idx_match_participants_puuid ON core.match_participants USING btree (puuid);
CREATE INDEX idx_participants_champion_win ON core.match_participants USING btree (champion_id, win);
CREATE INDEX idx_participants_kills_deaths ON core.match_participants USING btree (kills, deaths);
CREATE INDEX idx_participants_match_puuid ON core.match_participants USING btree (match_id, puuid);
CREATE INDEX idx_participants_position_champion ON core.match_participants USING btree (individual_position, champion_id);
CREATE INDEX idx_participants_team_win ON core.match_participants USING btree (team_id, win);
CREATE INDEX ix_app_match_participants_champion_id ON core.match_participants USING btree (champion_id);
CREATE INDEX ix_app_match_participants_champion_name ON core.match_participants USING btree (champion_name);
CREATE INDEX ix_app_match_participants_individual_position ON core.match_participants USING btree (individual_position);
CREATE INDEX ix_app_match_participants_match_id ON core.match_participants USING btree (match_id);
CREATE INDEX ix_app_match_participants_puuid ON core.match_participants USING btree (puuid);
CREATE INDEX ix_app_match_participants_role ON core.match_participants USING btree (role);
CREATE INDEX ix_app_match_participants_team_id ON core.match_participants USING btree (team_id);
CREATE INDEX ix_app_match_participants_team_position ON core.match_participants USING btree (team_position);

-- [table] core.matchmaking_analyses

CREATE SEQUENCE core.matchmaking_analyses_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE TABLE core.matchmaking_analyses (
    id bigint DEFAULT nextval('core.matchmaking_analyses_id_seq'::regclass) NOT NULL,
    puuid character varying(78) NOT NULL,
    status character varying(20) NOT NULL,
    progress bigint NOT NULL,
    total_requests bigint NOT NULL,
    estimated_minutes_remaining bigint NOT NULL,
    results jsonb,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER SEQUENCE core.matchmaking_analyses_id_seq OWNED BY core.matchmaking_analyses.id;

ALTER TABLE ONLY core.matchmaking_analyses
    ADD CONSTRAINT pk_matchmaking_analyses PRIMARY KEY (id);

CREATE INDEX ix_app_matchmaking_analyses_puuid ON core.matchmaking_analyses USING btree (puuid);
CREATE INDEX ix_app_matchmaking_analyses_status ON core.matchmaking_analyses USING btree (status);
CREATE INDEX ix_matchmaking_analyses_created_at ON core.matchmaking_analyses USING btree (created_at);
CREATE INDEX ix_matchmaking_analyses_puuid_status ON core.matchmaking_analyses USING btree (puuid, status);

-- [table] core.player_analysis

CREATE SEQUENCE core.player_analysis_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE TABLE core.player_analysis (
    id integer DEFAULT nextval('core.player_analysis_id_seq'::regclass) NOT NULL,
    puuid character varying(78) NOT NULL,
    is_smurf boolean NOT NULL,
    confidence character varying(32),
    smurf_score numeric(5,3) NOT NULL,
    win_rate_score numeric(5,3),
    kda_score numeric(5,3),
    account_level_score numeric(5,3),
    rank_discrepancy_score numeric(5,3),
    rank_progression_score numeric(5,3),
    win_rate_trend_score numeric(5,3),
    performance_consistency_score numeric(5,3),
    performance_trends_score numeric(5,3),
    role_performance_score numeric(5,3),
    games_analyzed integer NOT NULL,
    queue_type character varying(32),
    time_period_days integer,
    win_rate_threshold numeric(5,3),
    kda_threshold numeric(5,3),
    account_level integer,
    current_tier character varying(16),
    current_rank character varying(4),
    peak_tier character varying(16),
    peak_rank character varying(4),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_analysis timestamp with time zone DEFAULT now() NOT NULL,
    analysis_version character varying(16),
    false_positive_reported boolean NOT NULL,
    manually_verified boolean NOT NULL,
    notes text
);

ALTER SEQUENCE core.player_analysis_id_seq OWNED BY core.player_analysis.id;

ALTER TABLE ONLY core.player_analysis
    ADD CONSTRAINT pk_player_analysis PRIMARY KEY (id);

CREATE INDEX idx_player_analysis_analysis_time ON core.player_analysis USING btree (last_analysis, is_smurf);
CREATE INDEX idx_player_analysis_false_positive ON core.player_analysis USING btree (false_positive_reported, is_smurf);
CREATE INDEX idx_player_analysis_is_smurf_score ON core.player_analysis USING btree (is_smurf, smurf_score);
CREATE INDEX idx_player_analysis_puuid_confidence ON core.player_analysis USING btree (puuid, confidence);
CREATE INDEX idx_player_analysis_queue_score ON core.player_analysis USING btree (queue_type, smurf_score);
CREATE INDEX ix_core_player_analysis_confidence ON core.player_analysis USING btree (confidence);
CREATE INDEX ix_core_player_analysis_false_positive_reported ON core.player_analysis USING btree (false_positive_reported);
CREATE INDEX ix_core_player_analysis_is_smurf ON core.player_analysis USING btree (is_smurf);
CREATE INDEX ix_core_player_analysis_last_analysis ON core.player_analysis USING btree (last_analysis);
CREATE INDEX ix_core_player_analysis_manually_verified ON core.player_analysis USING btree (manually_verified);
CREATE INDEX ix_core_player_analysis_puuid ON core.player_analysis USING btree (puuid);
CREATE INDEX ix_core_player_analysis_queue_type ON core.player_analysis USING btree (queue_type);
CREATE INDEX ix_core_player_analysis_smurf_score ON core.player_analysis USING btree (smurf_score);

-- [table] core.player_ranks

CREATE SEQUENCE core.player_ranks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE TABLE core.player_ranks (
    id integer DEFAULT nextval('core.player_ranks_id_seq'::regclass) NOT NULL,
    puuid character varying(78) NOT NULL,
    queue_type character varying(32) NOT NULL,
    tier character varying(16) NOT NULL,
    rank character varying(4),
    league_points integer NOT NULL,
    wins integer NOT NULL,
    losses integer NOT NULL,
    veteran boolean NOT NULL,
    inactive boolean NOT NULL,
    fresh_blood boolean NOT NULL,
    hot_streak boolean NOT NULL,
    league_id character varying(64),
    league_name character varying(64),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    season_id character varying(16),
    is_current boolean NOT NULL
);

ALTER SEQUENCE core.player_ranks_id_seq OWNED BY core.player_ranks.id;

ALTER TABLE ONLY core.player_ranks
    ADD CONSTRAINT pk_player_ranks PRIMARY KEY (id);

CREATE INDEX idx_ranks_puuid_current ON core.player_ranks USING btree (puuid, is_current);
CREATE INDEX idx_ranks_puuid_queue ON core.player_ranks USING btree (puuid, queue_type);
CREATE INDEX idx_ranks_queue_current ON core.player_ranks USING btree (queue_type, is_current);
CREATE INDEX idx_ranks_tier_lp ON core.player_ranks USING btree (tier, league_points);
CREATE INDEX idx_ranks_tier_rank ON core.player_ranks USING btree (tier, rank);
CREATE INDEX ix_app_player_ranks_is_current ON core.player_ranks USING btree (is_current);
CREATE INDEX ix_app_player_ranks_league_id ON core.player_ranks USING btree (league_id);
CREATE INDEX ix_app_player_ranks_puuid ON core.player_ranks USING btree (puuid);
CREATE INDEX ix_app_player_ranks_queue_type ON core.player_ranks USING btree (queue_type);
CREATE INDEX ix_app_player_ranks_rank ON core.player_ranks USING btree (rank);
CREATE INDEX ix_app_player_ranks_season_id ON core.player_ranks USING btree (season_id);
CREATE INDEX ix_app_player_ranks_tier ON core.player_ranks USING btree (tier);

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
    detailed_logs jsonb
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

ALTER TABLE ONLY core.player_analysis
    ADD CONSTRAINT fk_player_analysis_puuid_players FOREIGN KEY (puuid) REFERENCES core.players(puuid) ON DELETE CASCADE;

ALTER TABLE ONLY core.player_ranks
    ADD CONSTRAINT fk_player_ranks_puuid_players FOREIGN KEY (puuid) REFERENCES core.players(puuid) ON DELETE CASCADE;

ALTER TABLE ONLY jobs.job_executions
    ADD CONSTRAINT fk_job_executions_job_config_id_job_configurations FOREIGN KEY (job_config_id) REFERENCES jobs.job_configurations(id) ON DELETE CASCADE;
