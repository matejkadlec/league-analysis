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
  matches_analyzed: z.number().int().optional().default(0),
  fully_analyzed: z.boolean().optional().default(false),
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
export type PlaystyleTag = z.infer<typeof PlaystyleTagSchema>;
export type PlaystyleAnalysisResponse = z.infer<
  typeof PlaystyleAnalysisResponseSchema
>;
export type PlaystyleAnalysisRequest = z.infer<
  typeof PlaystyleAnalysisRequestSchema
>;

// ===== JOB SCHEMAS =====

// Job Type Enum (must match backend enum values)
export const JobTypeSchema = z.enum([
  "TRACKED_PLAYER_UPDATER",
  "MATCH_FETCHER",
  "PLAYER_ANALYZER",
  "BAN_CHECKER",
]);

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

// Encounter Match Schema
export const EncounterMatchSchema = z.object({
  match_id: z.string(),
  game_name: z.string(),
  tag_line: z.string().optional().nullable(),
  champion_name: z.string(),
  team_id: z.number(),
  is_teammate: z.boolean(),
  win: z.boolean(),
  kda: z.number(),
});

export const RecentOpponentsSchema = z.array(PlayerSchema);
export type RecentOpponents = z.infer<typeof RecentOpponentsSchema>;

// ===== PLAYER RANK SCHEMA =====
export const PlayerRankSchema = z.object({
  id: z.number(),
  puuid: z.string(),
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
  league_id: z.string().nullable(),
  league_name: z.string().nullable(),
  season_id: z.string().nullable(),
  is_current: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  win_rate: z.number(),
  total_games: z.number(),
  display_rank: z.string(),
});

export type PlayerRank = z.infer<typeof PlayerRankSchema>;

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
