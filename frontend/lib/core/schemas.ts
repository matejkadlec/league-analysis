import { z } from "zod";

// Player Schema
export const PlayerSchema = z.object({
  puuid: z.string(),
  game_name: z.string().optional().nullable(),
  tag_line: z.string().optional().nullable(),
  platform: z.string(),
  summoner_level: z.number().int().optional().nullable(),
  profile_icon_id: z.number().optional().nullable(),
  id: z.coerce.number().optional().nullable(),
  is_tracked: z.boolean().optional().default(false),
  analyzed_matches: z.number().int().optional().default(0),
  total_matches: z.number().int().optional().default(0),
  last_playstyle_analysis: z.string().optional().nullable(),
  last_matchmaking_analysis: z.string().optional().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type Player = z.infer<typeof PlayerSchema>;

// Match Schema
export const MatchSchema = z.object({
  match_id: z.string(),
  platform: z.string(),
  game_start_timestamp: z.number(),
  game_duration: z.number(),
  queue_id: z.number(),
  game_version: z.string(),
  map_id: z.number(),
  game_mode: z.string().optional().nullable(),
  game_type: z.string().optional().nullable(),
  game_end_timestamp: z.number().optional().nullable(),
  early_surrender: z.boolean().optional().nullable(),
  surrender: z.boolean().optional().nullable(),
  game_result: z.string().optional().nullable(),
  fully_analyzed: z.boolean(),
  processing_error: z.string().optional().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  game_start_datetime: z.string().optional().nullable(),
  game_end_datetime: z.string().optional().nullable(),
  patch_version: z.string().optional().nullable(),
  is_ranked_match: z.boolean().optional(),
  is_normal_match: z.boolean().optional(),
});

// Match List Response Schema
export const MatchListResponseSchema = z.object({
  matches: z.array(MatchSchema),
  total: z.number(),
  total_analyzed: z.number().optional().default(0),
  page: z.number(),
  size: z.number(),
  pages: z.number(),
});

// Runes Schema for participant data
export const ParticipantRunesSchema = z.object({
  primary_style: z.number().optional().nullable(),
  sub_style: z.number().optional().nullable(),
  keystone: z.number().optional().nullable(),
  primary_perks: z.array(z.number()).optional().nullable(),
  sub_perks: z.array(z.number()).optional().nullable(),
  stat_perks: z
    .object({
      defense: z.number().optional().nullable(),
      flex: z.number().optional().nullable(),
      offense: z.number().optional().nullable(),
    })
    .optional()
    .nullable(),
});

export type ParticipantRunes = z.infer<typeof ParticipantRunesSchema>;

// Player Match Participant Schema (for detailed match list)
export const PlayerMatchParticipantSchema = z.object({
  champion_id: z.number(),
  champion_name: z.string(),
  champion_level: z.number(),
  team_position: z.string().optional().nullable(),
  team_id: z.number(),
  win: z.boolean(),
  remake: z.boolean().default(false),
  kills: z.number().default(0),
  deaths: z.number().default(0),
  assists: z.number().default(0),
  kda: z.number().optional().nullable(),
  total_cs: z.number().default(0),
  vision_score: z.number().default(0),
  total_damage_dealt_to_champions: z.number().default(0),
  summoner1_id: z.number().optional().nullable(),
  summoner2_id: z.number().optional().nullable(),
  runes: ParticipantRunesSchema.optional().nullable(),
});

// Enemy Lane Opponent Schema
export const EnemyLaneOpponentSchema = z.object({
  champion_id: z.number(),
  champion_name: z.string(),
  champion_level: z.number(),
  kills: z.number().default(0),
  deaths: z.number().default(0),
  assists: z.number().default(0),
  kda: z.number().optional().nullable(),
  total_cs: z.number().default(0),
  vision_score: z.number().default(0),
  total_damage_dealt_to_champions: z.number().default(0),
  summoner1_id: z.number().optional().nullable(),
  summoner2_id: z.number().optional().nullable(),
  runes: ParticipantRunesSchema.optional().nullable(),
});

// Team Stats Schema
export const TeamStatsSchema = z.object({
  kills: z.number().default(0),
  deaths: z.number().default(0),
  assists: z.number().default(0),
  turrets: z.number().nullable().optional(),
  inhibitors: z.number().nullable().optional(),
  dragons: z.number().nullable().optional(),
  barons: z.number().default(0),
  rift_heralds: z.number().default(0),
  voidgrubs: z.number().nullable().optional(),
});

export type TeamStats = z.infer<typeof TeamStatsSchema>;

// Team Stats Composition Schema
export const TeamStatsCompositionSchema = z.object({
  blue_team: TeamStatsSchema.optional().nullable(),
  red_team: TeamStatsSchema.optional().nullable(),
});

export type TeamStatsComposition = z.infer<typeof TeamStatsCompositionSchema>;

// Team Champion Schema (for team compositions)
export const TeamChampionSchema = z.object({
  champion_id: z.number(),
  champion_name: z.string(),
  team_position: z.string().optional().nullable(),
  puuid: z.string(),
});

// Team Composition Schema
export const TeamCompositionSchema = z.object({
  blue_team: z.array(TeamChampionSchema),
  red_team: z.array(TeamChampionSchema),
});

// Match With Player Data Schema
export const MatchWithPlayerDataSchema = MatchSchema.extend({
  player_participant: PlayerMatchParticipantSchema.optional().nullable(),
  lane_opponent: EnemyLaneOpponentSchema.optional().nullable(),
  lp_change: z.number().optional().nullable(),
  team_compositions: TeamCompositionSchema.optional().nullable(),
  team_stats: TeamStatsCompositionSchema.optional().nullable(),
});

// Detailed Match List Response Schema
export const MatchListWithPlayerDataResponseSchema = z.object({
  matches: z.array(MatchWithPlayerDataSchema),
  total: z.number(),
  total_analyzed: z.number().optional().default(0),
  page: z.number(),
  size: z.number(),
  pages: z.number(),
});

// Match Stats Response Schema
export const MatchStatsResponseSchema = z.object({
  puuid: z.string(),
  total_matches: z.number(),
  wins: z.number(),
  losses: z.number(),
  win_rate: z.number(),
  avg_kills: z.number(),
  avg_deaths: z.number(),
  avg_assists: z.number(),
  avg_kda: z.number(),
  avg_cs: z.number(),
  avg_vision_score: z.number(),
});

// Champion Stats Item Schema
export const ChampionStatsItemSchema = z.object({
  champion_name: z.string(),
  champion_id: z.number(),
  games_played: z.number(),
  wins: z.number(),
  losses: z.number(),
  win_rate: z.number(),
  avg_kills: z.number(),
  avg_deaths: z.number(),
  avg_assists: z.number(),
  avg_kda: z.number(),
});

export type ChampionStatsItem = z.infer<typeof ChampionStatsItemSchema>;

// Champion Stats Response Schema
export const ChampionStatsResponseSchema = z.object({
  puuid: z.string(),
  total_champions: z.number(),
  champions: z.array(ChampionStatsItemSchema),
});

export type ChampionStatsResponse = z.infer<typeof ChampionStatsResponseSchema>;

// Lane Stats Item Schema
export const LaneStatsItemSchema = z.object({
  lane: z.string(),
  games_played: z.number(),
  wins: z.number(),
  losses: z.number(),
  win_rate: z.number(),
  avg_kills: z.number(),
  avg_deaths: z.number(),
  avg_assists: z.number(),
  avg_kda: z.number(),
});

export type LaneStatsItem = z.infer<typeof LaneStatsItemSchema>;

// Lane Stats Response Schema
export const LaneStatsResponseSchema = z.object({
  puuid: z.string(),
  total_lanes: z.number(),
  lanes: z.array(LaneStatsItemSchema),
});

export type LaneStatsResponse = z.infer<typeof LaneStatsResponseSchema>;

// Match Participant Schema
export const MatchParticipantSchema = z.object({
  match_id: z.string(),
  participant_id: z.number(),
  puuid: z.string(),
  game_name: z.string().optional().nullable(),
  tag_line: z.string().optional().nullable(),
  summoner_id: z.string().optional().nullable(),
  profile_icon: z.number().default(0),
  summoner_level: z.number().default(1),

  // Team
  team_id: z.number(),
  team_position: z.string().optional().nullable(),

  // Champion
  champion_id: z.number(),
  champion_name: z.string(),
  champion_level: z.number().default(1),
  champion_transform: z.number().default(0),

  // Results
  win: z.boolean(),
  remake: z.boolean().default(false),

  // KDA
  kills: z.number().default(0),
  deaths: z.number().default(0),
  assists: z.number().default(0),
  kda: z.coerce.number().optional().nullable(),
  largest_multi_kill: z.number().default(0),
  largest_killing_spree: z.number().default(0),

  // Damage
  total_damage_dealt_to_champions: z.number().default(0),
  total_damage_taken: z.number().default(0),

  // Vision
  vision_score: z.number().default(0),
  wards_placed: z.number().default(0),
  wards_killed: z.number().default(0),

  // Farming
  total_minions_killed: z.number().default(0),
  neutral_minions_killed: z.number().default(0),
  gold_earned: z.number().default(0),
  gold_spent: z.number().default(0),

  // Items
  item0: z.number().default(0),
  item1: z.number().default(0),
  item2: z.number().default(0),
  item3: z.number().default(0),
  item4: z.number().default(0),
  item5: z.number().default(0),
  trinket: z.number().default(0),

  // JSON
  runes: z.record(z.string(), z.any()).nullable().optional(),
  advanced_stats: z.record(z.string(), z.any()).nullable().optional(),
});

// Playstyle Tag Schema
// Allowing the struct to be flexible because the backend returns a flexible dictionary
export const PlaystyleTagSchema = z
  .object({
    value: z.number().optional().default(0),
    threshold_met: z.boolean().optional().default(false),
    description: z.string().optional(),
    details: z.string().optional(),
  })
  .passthrough();

// Playstyle Analysis Response Schema
export const PlaystyleAnalysisResponseSchema = z.object({
  id: z.number().optional(),
  puuid: z.string(),
  status: z.enum([
    "PENDING",
    "IN_PROGRESS",
    "COMPLETED",
    "FAILED",
    "CANCELLED",
  ]),
  tags: z.record(z.string(), PlaystyleTagSchema),
  summary_stats: z.record(z.string(), z.any()),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

// Playstyle Analysis Request Schema
export const PlaystyleAnalysisRequestSchema = z.object({
  puuid: z.string(),
  force_reanalyze: z.boolean().optional().default(true),
});

// Infer TypeScript types from schemas
export type Match = z.infer<typeof MatchSchema>;
export type MatchListResponse = z.infer<typeof MatchListResponseSchema>;
export type MatchStatsResponse = z.infer<typeof MatchStatsResponseSchema>;
export type MatchParticipant = z.infer<typeof MatchParticipantSchema>;
export type PlayerMatchParticipant = z.infer<
  typeof PlayerMatchParticipantSchema
>;
export type EnemyLaneOpponent = z.infer<typeof EnemyLaneOpponentSchema>;
export type TeamChampion = z.infer<typeof TeamChampionSchema>;
export type TeamComposition = z.infer<typeof TeamCompositionSchema>;
export type MatchWithPlayerData = z.infer<typeof MatchWithPlayerDataSchema>;
export type MatchListWithPlayerDataResponse = z.infer<
  typeof MatchListWithPlayerDataResponseSchema
>;
export type PlaystyleTag = z.infer<typeof PlaystyleTagSchema>;
export type PlaystyleAnalysisResponse = z.infer<
  typeof PlaystyleAnalysisResponseSchema
>;
export type PlaystyleAnalysisRequest = z.infer<
  typeof PlaystyleAnalysisRequestSchema
>;

// ===== JOB SCHEMAS =====

// Job Type Enum (must match backend enum values)
export const JobTypeSchema = z.enum(["MATCH_FETCHER", "PLAYER_UPDATER"]);

// Job Status Enum (must match backend enum values)
export const JobStatusSchema = z.enum([
  "PENDING",
  "RUNNING",
  "SUCCESS",
  "FAILED",
  "RATE_LIMITED",
]);

// Job Configuration Schema
export const JobConfigurationSchema = z.object({
  id: z.number(),
  job_type: JobTypeSchema,
  name: z.string(),
  description: z.string().nullable().optional(),
  schedule: z.string(),
  is_active: z.boolean(),
  config_json: z.record(z.string(), z.any()).nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

// Job Execution Schema
export const JobExecutionSchema = z.object({
  id: z.number(),
  job_config_id: z.number(),
  started_at: z.string(),
  completed_at: z.string().nullable().optional(),
  status: JobStatusSchema,
  api_requests_made: z.number().default(0),
  records_created: z.number().default(0),
  records_updated: z.number().default(0),
  error_message: z.string().nullable().optional(),
  execution_log: z.record(z.string(), z.any()).nullable().optional(),
  detailed_logs: z.record(z.string(), z.any()).nullable().optional(),
  triggered_by: z.string().default("system"),
  has_api_key_error: z.boolean().default(false),
});

// Job Status Response Schema
export const JobStatusResponseSchema = z.object({
  scheduler_running: z.boolean(),
  active_jobs: z.number(),
  running_executions: z.number(),
  last_execution: JobExecutionSchema.nullable().optional(),
  next_run_time: z.string().nullable().optional(),
});

// Job Trigger Response Schema
export const JobTriggerResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  execution_id: z.number().nullable().optional(),
});

// Job Execution List Response Schema
export const JobExecutionListResponseSchema = z.object({
  executions: z.array(JobExecutionSchema),
  total: z.number(),
  page: z.number(),
  size: z.number(),
  pages: z.number(),
});

// Infer TypeScript types for Jobs
export type JobType = z.infer<typeof JobTypeSchema>;
export type JobStatus = z.infer<typeof JobStatusSchema>;
export type JobConfiguration = z.infer<typeof JobConfigurationSchema>;
export type JobExecution = z.infer<typeof JobExecutionSchema>;
export type JobStatusResponse = z.infer<typeof JobStatusResponseSchema>;
export type JobTriggerResponse = z.infer<typeof JobTriggerResponseSchema>;
export type JobExecutionListResponse = z.infer<
  typeof JobExecutionListResponseSchema
>;

// ===== PLAYER LEAGUE SCHEMA =====
// Simplified immutable league snapshot (ordered by created_at DESC for current)
export const PlayerLeagueSchema = z.object({
  puuid: z.string(),
  league_id: z.string(),
  queue_type: z.string(),
  tier: z.string(),
  rank: z.string().nullable(),
  league_points: z.number(),
  wins: z.number(),
  losses: z.number(),
  veteran: z.boolean(),
  inactive: z.boolean(),
  fresh_blood: z.boolean(),
  hot_streak: z.boolean(),
  created_at: z.string(),
  // Computed properties from backend
  win_rate: z.number(),
  total_games: z.number(),
  display_rank: z.string(),
});

export type PlayerLeague = z.infer<typeof PlayerLeagueSchema>;

// ===== SYSTEM SETTINGS SCHEMA =====
export const SettingSchema = z.object({
  key: z.string(),
  masked_value: z.string(),
  category: z.string(),
  is_sensitive: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const SettingUpdateSchema = z.object({
  value: z.string().min(1, "Value is required"),
});

export const SettingTestResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  details: z.record(z.string(), z.any()).nullable().optional(),
});

export type Setting = z.infer<typeof SettingSchema>;
export type SettingUpdate = z.infer<typeof SettingUpdateSchema>;
export type SettingTestResponse = z.infer<typeof SettingTestResponseSchema>;

// ===== USER SETTINGS SCHEMA =====
export const ThemeEnum = z.enum(["LIGHT", "DARK"]);
export type Theme = z.infer<typeof ThemeEnum>;

export const UserSettingsSchema = z.object({
  theme: ThemeEnum,
  save_playstyle_url: z.boolean(),
  saved_playstyle_puuid: z.string().nullable(),
  save_matchmaking_url: z.boolean(),
  saved_matchmaking_puuid: z.string().nullable(),
  default_platform: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const UserSettingsUpdateSchema = z.object({
  theme: ThemeEnum.optional(),
  save_playstyle_url: z.boolean().optional(),
  saved_playstyle_puuid: z.string().nullable().optional(),
  save_matchmaking_url: z.boolean().optional(),
  saved_matchmaking_puuid: z.string().nullable().optional(),
  default_platform: z.string().nullable().optional(),
});

export type UserSettings = z.infer<typeof UserSettingsSchema>;
export type UserSettingsUpdate = z.infer<typeof UserSettingsUpdateSchema>;

// ===== USER PROFILE SCHEMAS =====
export const UserResponseSchema = z.object({
  id: z.number(),
  email: z.string().email(),
  display_name: z.string(),
  is_active: z.boolean(),
  is_admin: z.boolean(),
  email_verified: z.boolean(),
  email_verified_at: z.string().nullable(),
  last_login: z.string().nullable(),
  riot_account_connected: z.boolean(),
  puuid: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type UserResponse = z.infer<typeof UserResponseSchema>;

export const UserProfileUpdateSchema = z.object({
  display_name: z.string().min(1).max(128).optional(),
});

export type UserProfileUpdate = z.infer<typeof UserProfileUpdateSchema>;

// ===== MATCHMAKING ANALYSIS SCHEMAS =====
export const MatchmakingAnalysisResultsSchema = z.object({
  team_avg_winrate: z.number().min(0).max(1),
  enemy_avg_winrate: z.number().min(0).max(1),
  matches_analyzed: z.number().int().min(0),
});

export const MatchmakingAnalysisResponseSchema = z.object({
  id: z.number(),
  puuid: z.string(),
  status: z.string(),
  progress: z.number(),
  total_requests: z.number(),
  estimated_minutes_remaining: z.number(),
  results: MatchmakingAnalysisResultsSchema.nullable().optional(),
  error_message: z.string().nullable().optional(),
  created_at: z.string(),
  started_at: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
  updated_at: z.string(),
});

export const MatchmakingAnalysisStatusResponseSchema = z.object({
  id: z.number(),
  status: z.string(),
  progress: z.number(),
  total_requests: z.number(),
  estimated_minutes_remaining: z.number(),
  results: MatchmakingAnalysisResultsSchema.nullable().optional(),
  error_message: z.string().nullable().optional(),
});

export type MatchmakingAnalysisResults = z.infer<
  typeof MatchmakingAnalysisResultsSchema
>;
export type MatchmakingAnalysisResponse = z.infer<
  typeof MatchmakingAnalysisResponseSchema
>;
export type MatchmakingAnalysisStatusResponse = z.infer<
  typeof MatchmakingAnalysisStatusResponseSchema
>;
