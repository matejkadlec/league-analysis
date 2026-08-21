import { z } from "zod";

import { PLATFORMS } from "@/lib/core/platform-utils";

// Player Schema
export const PlayerSchema = z.object({
  puuid: z.string(),
  game_name: z.string(),
  tag_line: z.string(),
  // Derived from the display-name table rather than listed again: the two
  // used to be sixteen codes typed twice, checked in neither direction.
  platform: z.enum(PLATFORMS),
  summoner_level: z.number().int(),
  profile_icon_id: z.number().int(),
  is_tracked: z.boolean().optional().default(false),
  analyzed_matches: z.number().int().optional().default(0),
  total_matches: z.number().int().optional().default(0),
  last_playstyle_analysis: z.string().optional().nullable(),
  last_matchmaking_analysis: z.string().optional().nullable(),
  profile_synced_at: z.string().optional().nullable(),
  league_synced_at: z.string().optional().nullable(),
  match_synced_at: z.string().optional().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type Player = z.infer<typeof PlayerSchema>;

export const PlayerContextSchema = z.object({
  current_player: PlayerSchema.nullable(),
});

export type PlayerContext = z.infer<typeof PlayerContextSchema>;

export const PlayerSyncRunSchema = z.object({
  id: z.number().int(),
  puuid: z.string(),
  status: z.enum([
    "pending",
    "running",
    "completed",
    "failed",
    "cancelled",
    "rate_limited",
  ]),
  match_execution_id: z.number().int().nullable().optional(),
  profile_execution_id: z.number().int().nullable().optional(),
  error_code: z.string().nullable().optional(),
  error_message: z.string().nullable().optional(),
  created_at: z.string(),
  started_at: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
  updated_at: z.string(),
});

export type PlayerSyncRun = z.infer<typeof PlayerSyncRunSchema>;

// Match Schema
export const MatchSchema = z.object({
  match_id: z.string(),
  platform: z.string(),
  game_creation_timestamp: z.number().int(),
  game_start_timestamp: z.number().int(),
  game_start_timestamp_source: z.enum([
    "riot_game_start",
    "legacy_game_creation",
  ]),
  game_duration: z.number().int(),
  queue_id: z.number().int(),
  game_version: z.string(),
  map_id: z.number().int(),
  game_mode: z.string(),
  game_type: z.string(),
  game_end_timestamp: z.number().int(),
  early_surrender: z.boolean(),
  surrender: z.boolean(),
  game_result: z.string().optional().nullable(),
  fully_analyzed: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

// Runes Schema for participant data
export const ParticipantRunesSchema = z.object({
  primary_style: z.number().int().optional().nullable(),
  sub_style: z.number().int().optional().nullable(),
  keystone: z.number().int().optional().nullable(),
  primary_perks: z.array(z.number().int()).optional().nullable(),
  sub_perks: z.array(z.number().int()).optional().nullable(),
  stat_perks: z
    .object({
      defense: z.number().int().optional().nullable(),
      flex: z.number().int().optional().nullable(),
      offense: z.number().int().optional().nullable(),
    })
    .optional()
    .nullable(),
});

export type ParticipantRunes = z.infer<typeof ParticipantRunesSchema>;

// Player Match Participant Schema (for detailed match list)
export const PlayerMatchParticipantSchema = z.object({
  champion_id: z.number().int(),
  champion_name: z.string(),
  champion_level: z.number().int(),
  team_position: z.string().optional().nullable(),
  team_id: z.number().int(),
  win: z.boolean(),
  remake: z.boolean().default(false),
  kills: z.number().int().default(0),
  deaths: z.number().int().default(0),
  assists: z.number().int().default(0),
  kda: z.number(),
  total_cs: z.number().int().default(0),
  vision_score: z.number().int().default(0),
  total_damage_dealt_to_champions: z.number().int().default(0),
  summoner1_id: z.number().int().optional().nullable(),
  summoner2_id: z.number().int().optional().nullable(),
  runes: ParticipantRunesSchema.optional().nullable(),
});

// Enemy Lane Opponent Schema
export const EnemyLaneOpponentSchema = PlayerMatchParticipantSchema.omit({
  team_position: true,
  team_id: true,
  win: true,
  remake: true,
});

// Team Stats Schema
export const TeamStatsSchema = z.object({
  kills: z.number().int().default(0),
  deaths: z.number().int().default(0),
  assists: z.number().int().default(0),
  turrets: z.number().int().nullable().optional(),
  inhibitors: z.number().int().nullable().optional(),
  dragons: z.number().int().nullable().optional(),
  barons: z.number().int().default(0),
  rift_heralds: z.number().int().default(0),
  voidgrubs: z.number().int().nullable().optional(),
});

export type TeamStats = z.infer<typeof TeamStatsSchema>;

// Team Stats Composition Schema
export const TeamStatsCompositionSchema = z.object({
  blue_team: TeamStatsSchema,
  red_team: TeamStatsSchema,
});

export type TeamStatsComposition = z.infer<typeof TeamStatsCompositionSchema>;

// Team Champion Schema (for team compositions)
export const TeamChampionSchema = z.object({
  champion_id: z.number().int(),
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
  lp_change: z.number().int().optional().nullable(),
  team_compositions: TeamCompositionSchema.optional().nullable(),
  team_stats: TeamStatsCompositionSchema.optional().nullable(),
});

// The four counters every paginated endpoint answers with, mirroring the
// backend's `PaginatedResponse`. Spelled once so a page cannot mean `size`
// here and `page_size` there.
const paginationFields = {
  total: z.number().int(),
  page: z.number().int(),
  size: z.number().int(),
  pages: z.number().int(),
};

// Detailed Match List Response Schema
export const MatchListWithPlayerDataResponseSchema = z.object({
  matches: z.array(MatchWithPlayerDataSchema),
  total_analyzed: z.number().int().optional().default(0),
  ...paginationFields,
});

// The win/loss and per-game averages the backend returns for every stats
// grouping -- overall, per champion, per lane. Spelled once so a new metric
// cannot land on two of the three.
const performanceStatsFields = {
  wins: z.number().int(),
  losses: z.number().int(),
  win_rate: z.number(),
  avg_kills: z.number(),
  avg_deaths: z.number(),
  avg_assists: z.number(),
  avg_kda: z.number(),
} as const;

/** The figures `PerformanceFigures` renders, whichever grouping they describe. */
export type PerformanceStats = z.infer<z.ZodObject<typeof performanceStatsFields>>;

// Match Stats Response Schema
export const MatchStatsResponseSchema = z.object({
  puuid: z.string(),
  total_matches: z.number().int(),
  ...performanceStatsFields,
  avg_cs: z.number(),
  avg_vision_score: z.number(),
});

// Champion Stats Item Schema
export const ChampionStatsItemSchema = z.object({
  champion_name: z.string(),
  champion_id: z.number().int(),
  games_played: z.number().int(),
  ...performanceStatsFields,
});

export type ChampionStatsItem = z.infer<typeof ChampionStatsItemSchema>;

// Champion Stats Response Schema
export const ChampionStatsResponseSchema = z.object({
  puuid: z.string(),
  total_champions: z.number().int(),
  champions: z.array(ChampionStatsItemSchema),
});

export type ChampionStatsResponse = z.infer<typeof ChampionStatsResponseSchema>;

// Lane Stats Item Schema
export const LaneStatsItemSchema = z.object({
  lane: z.string(),
  games_played: z.number().int(),
  ...performanceStatsFields,
});

export type LaneStatsItem = z.infer<typeof LaneStatsItemSchema>;

// Lane Stats Response Schema
export const LaneStatsResponseSchema = z.object({
  puuid: z.string(),
  total_lanes: z.number().int(),
  lanes: z.array(LaneStatsItemSchema),
});

export type LaneStatsResponse = z.infer<typeof LaneStatsResponseSchema>;

// Infer TypeScript types from schemas
export type Match = z.infer<typeof MatchSchema>;
export type MatchStatsResponse = z.infer<typeof MatchStatsResponseSchema>;
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

// ===== JOB SCHEMAS =====

// Job Type Enum (must match backend enum values)
export const JobTypeSchema = z.enum(["MATCH_FETCHER", "PLAYER_UPDATER"]);

// Job Status Enum (must match backend enum values)
export const JobStatusSchema = z.enum([
  "PENDING",
  "RUNNING",
  "PAUSED",
  "SUCCESS",
  "FAILED",
  "CANCELLED",
  "RATE_LIMITED",
]);

// Execution Type Enum (must match backend enum values)
export const ExecutionTypeSchema = z.enum(["REGULAR", "TEST"]);

// Job Configuration Schema
export const JobConfigurationSchema = z.object({
  id: z.number().int(),
  job_type: JobTypeSchema,
  name: z.string(),
  description: z.string().nullable().optional(),
  schedule: z.string(),
  is_active: z.boolean(),
  is_paused: z.boolean().default(false),
  is_running: z.boolean().default(false),
  is_stopping: z.boolean().default(false),
  is_force_stopping: z.boolean().default(false),
  is_test_running: z.boolean().default(false),
  is_test_paused: z.boolean().default(false),
  is_test_stopping: z.boolean().default(false),
  is_test_force_stopping: z.boolean().default(false),
  config_json: z.record(z.string(), z.unknown()).nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

// Job Execution Schema
// The other half of backend/app/features/jobs/base.py:StoredAPICall. A single
// call keeps its whole params dict; a group keeps only the key that varied.
export const JobExecutionApiCallSchema = z.object({
  endpoint: z.string(),
  region: z.string(),
  count: z.number().int(),
  first_timestamp: z.string().nullable(),
  last_timestamp: z.string().nullable(),
  // Null, not absent: the API declares all four `str | None`, so Pydantic
  // serialises the variant this entry is not as `null`.
  params: z.record(z.string(), z.string()).nullable().optional(),
  param_key: z.string().nullable().optional(),
  first_param: z.string().nullable().optional(),
  last_param: z.string().nullable().optional(),
});

export const JobExecutionSchema = z.object({
  id: z.number().int(),
  job_config_id: z.number().int(),
  started_at: z.string(),
  completed_at: z.string().nullable().optional(),
  status: JobStatusSchema,
  api_requests_made: z.number().int().default(0),
  records_created: z.number().int().default(0),
  records_updated: z.number().int().default(0),
  error_message: z.string().nullable().optional(),
  execution_log: z.record(z.string(), z.unknown()).nullable().optional(),
  // The column is nullable -- an execution can have no detailed logs at all --
  // but when it has them both lists are always present, empty or not.
  detailed_logs: z
    .object({
      logs: z.array(z.record(z.string(), z.unknown())),
      api_calls: z.array(JobExecutionApiCallSchema),
    })
    .nullable()
    .optional(),
  triggered_by: z.string().default("system"),
  has_api_key_error: z.boolean().default(false),
  execution_type: ExecutionTypeSchema.default("REGULAR"),
});

// Job Status Response Schema
export const JobStatusResponseSchema = z.object({
  scheduler_running: z.boolean(),
  active_jobs: z.number().int(),
  running_executions: z.number().int(),
  last_execution: JobExecutionSchema.nullable().optional(),
  next_run_time: z.string().nullable().optional(),
});

// Job Trigger Response Schema
export const JobTriggerResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  execution_id: z.number().int().nullable().optional(),
});

export const JobControlActionResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  is_running: z.boolean(),
  is_paused: z.boolean(),
  is_stopping: z.boolean(),
  is_force_stopping: z.boolean(),
});

// Job Execution List Response Schema
export const JobExecutionListResponseSchema = z.object({
  executions: z.array(JobExecutionSchema),
  ...paginationFields,
});

// Infer TypeScript types for Jobs
export type JobType = z.infer<typeof JobTypeSchema>;
export type JobStatus = z.infer<typeof JobStatusSchema>;
export type ExecutionType = z.infer<typeof ExecutionTypeSchema>;
export type JobConfiguration = z.infer<typeof JobConfigurationSchema>;
export type JobExecution = z.infer<typeof JobExecutionSchema>;
export type JobExecutionApiCall = z.infer<typeof JobExecutionApiCallSchema>;
export type JobStatusResponse = z.infer<typeof JobStatusResponseSchema>;
export type JobTriggerResponse = z.infer<typeof JobTriggerResponseSchema>;
export type JobControlActionResponse = z.infer<
  typeof JobControlActionResponseSchema
>;
export type JobExecutionListResponse = z.infer<
  typeof JobExecutionListResponseSchema
>;

// ===== PLAYER LEAGUE SCHEMA =====
// Simplified immutable league snapshot (ordered by created_at DESC for current)

/**
 * Riot's ten rank tiers, exactly as the API's `Tier` enum spells them.
 *
 * This was `z.string()`, so the one enum the API is strictest about arrived
 * here as an open string and `getRankColors` carried a grey fallback for a
 * value that cannot occur. An eleventh tier now fails at the parse, where the
 * app can say so, instead of rendering as unranked grey.
 */
export const TierSchema = z.enum([
  "IRON",
  "BRONZE",
  "SILVER",
  "GOLD",
  "PLATINUM",
  "EMERALD",
  "DIAMOND",
  "MASTER",
  "GRANDMASTER",
  "CHALLENGER",
]);
export type Tier = z.infer<typeof TierSchema>;

export const PlayerLeagueSchema = z.object({
  puuid: z.string(),
  queue_type: z.string(),
  tier: TierSchema,
  rank: z.string().nullable(),
  league_points: z.number().int(),
  wins: z.number().int(),
  losses: z.number().int(),
  created_at: z.string(),
  // Computed properties from backend
  // The API serves this one win rate as a percentage (PlayerLeague.win_rate
  // multiplies by 100); every sibling win_rate field is a 0-1 fraction, so
  // it is normalized here, at the boundary, and the app sees one unit.
  win_rate: z.number().transform((percent) => percent / 100),
  total_games: z.number().int(),
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

export const SettingTestResponseSchema = z.object({
  success: z.boolean(),
  status: z.enum(["valid", "invalid", "unavailable"]),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).nullable().optional(),
});

export type Setting = z.infer<typeof SettingSchema>;
export type SettingTestResponse = z.infer<typeof SettingTestResponseSchema>;

// ===== USER PROFILE SCHEMAS =====
export const UserResponseSchema = z.object({
  id: z.number().int(),
  email: z.email(),
  display_name: z.string(),
  is_active: z.boolean(),
  is_admin: z.boolean(),
  email_verified: z.boolean(),
  email_verified_at: z.string().nullable(),
  last_login: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type UserResponse = z.infer<typeof UserResponseSchema>;

export type UserProfileUpdate = {
  display_name?: string;
};

/**
 * The two request bodies that used to be posted through the raw client.
 *
 * Both re-spelled a backend enum as a hand-written TS union, and neither URL
 * was visible to `test_frontend_api_paths.py`, which scans for `validated*`
 * calls only. Declaring them here puts the enums inside the OpenAPI contract
 * test and the paths inside the path test.
 */
export const JoinUsSubjectSchema = z.enum([
  "beta_tester",
  "full_stack_developer",
  "other",
]);
export type JoinUsSubject = z.infer<typeof JoinUsSubjectSchema>;

export const JoinUsContactRequestSchema = z.object({
  subject: JoinUsSubjectSchema,
  body: z.string().min(1).max(5000),
  captcha_token: z.string().min(1).max(4096).nullable().optional(),
});

export const CookieConsentLevelSchema = z.enum(["necessary", "all"]);
export type CookieConsentLevel = z.infer<typeof CookieConsentLevelSchema>;

export const UserCookieConsentUpdateSchema = z.object({
  consent_level: CookieConsentLevelSchema,
  consent_version: z.string().min(1).max(16),
  consent_source: z.string().min(1).max(32),
});

export const UserCookieConsentResponseSchema = z.object({
  consent_level: CookieConsentLevelSchema,
  consent_version: z.string(),
  consent_source: z.string(),
  consented_at: z.string(),
});

export const MessageResponseSchema = z.object({
  message: z.string(),
});

export type MessageResponse = z.infer<typeof MessageResponseSchema>;

export const EmailChangeCodeResponseSchema = z.object({
  message: z.string(),
  expires_at: z.string(),
});

export type EmailChangeCodeResponse = z.infer<
  typeof EmailChangeCodeResponseSchema
>;

// ===== MATCHMAKING ANALYSIS SCHEMAS =====
export const MatchmakingAnalysisResultsSchema = z.object({
  team_avg_winrate: z.number().min(0).max(1),
  enemy_avg_winrate: z.number().min(0).max(1),
  matches_analyzed: z.number().int().min(0),
});

export const MatchmakingAnalysisStatusSchema = z.enum([
  "pending",
  "in_progress",
  "waiting_rate_limit",
  "completed",
  "failed",
  "cancelled",
]);

/**
 * Splits a parsed run into `completed` — the only variant that owns `results`
 * — and everything else, which has no `results` property at all. Reading
 * `run.results` without first narrowing on `run.status === "completed"` is
 * therefore a compile error, not a silent render of a failed run as a
 * successful one.
 *
 * The wire format is parsed permissively rather than rejected. Both backends
 * write `status` and `results` in a single UPDATE, but a row persisted before
 * that guarantee could still be `completed` with no results, and failing the
 * parse would break the page instead of degrading it. Such a run is reported
 * as `failed`, which is what it is: it finished without producing a result.
 *
 * The status and results fields are destructured out rather than left to the
 * rest spread. If a variant inherited the wire `status`, its discriminant
 * would be an intersection with the full enum instead of a bare literal, and
 * TypeScript would not discriminate the union on it.
 */
type RunLifecycleSplit<TWire extends { status: string }, TResults> =
  | (Omit<TWire, "status" | "results"> & {
      status: "completed";
      results: TResults;
    })
  | (Omit<TWire, "status" | "results"> & {
      // "failed" is unioned in rather than merely excluded, because the
      // malformed-completion branch below manufactures it. Leaving it out
      // would make this `never` for a wire type whose only status is
      // "completed", and the cast at the end would then be a lie.
      status: Exclude<TWire["status"], "completed"> | "failed";
    });

/**
 * Split a parsed run into a union where only `completed` carries `results`.
 *
 * `status` must be destructured out alongside `results`: if the rest spread
 * retains it, each variant's discriminant becomes an intersection with the
 * full status enum and TypeScript refuses to discriminate on it.
 *
 * `TResults` is constrained against the wire's own `results` so a caller
 * cannot ask for a type the payload does not carry. `undefined` is spelled out
 * in that constraint because `exactOptionalPropertyTypes` reads a bare
 * `results?: T | null` as "absent, or present and non-undefined", which no
 * Zod `.nullable().optional()` field satisfies.
 */
function splitRunOnLifecycle<
  TWire extends { status: string; results?: TResults | null | undefined },
  TResults,
>(run: TWire): RunLifecycleSplit<TWire, TResults> {
  const { results, status, ...common } = run;
  const split =
    status === "completed"
      ? results
        ? { ...common, status, results }
        : {
            ...common,
            status: "failed",
            // Both fields are replaced together. Overwriting only the code
            // would leave a legacy row's unrelated message describing a
            // different failure than the code names.
            error_code: "results_missing",
            error_message:
              "This run was stored as complete but carries no results.",
          }
      : { ...common, status };

  return split as RunLifecycleSplit<TWire, TResults>;
}

/**
 * One schema for every matchmaking run the API returns.
 *
 * `/status` used to have its own, differing only by `puuid_progress` -- a
 * per-PUUID map nothing reads, declared here as
 * `z.union([z.boolean(), z.string()])` against a `dict[str, bool]` column that
 * cannot hold a string. The server excludes the field now, so the two schemas
 * became the same expression.
 */
export const MatchmakingAnalysisResponseSchema = z
  .object({
    puuid: z.string(),
    status: MatchmakingAnalysisStatusSchema,
    progress: z.number().int(),
    total_puuids: z.number().int(),
    results: MatchmakingAnalysisResultsSchema.nullable().optional(),
    created_at: z.string(),
    started_at: z.string().nullable().optional(),
    completed_at: z.string().nullable().optional(),
    error_code: z.string().nullable().optional(),
    error_message: z.string().nullable().optional(),
    requests_saved: z.number().int().default(0),
    rate_limit_reset_at: z.string().nullable().optional(),
  })
  .transform((run) =>
    splitRunOnLifecycle<typeof run, MatchmakingAnalysisResults>(run),
  );

export const MatchmakingAnalysisHistoryItemSchema = z.object({
  created_at: z.string(),
  team_avg_winrate: z.number(),
  enemy_avg_winrate: z.number(),
  gap: z.number(),
});

export const MatchmakingAnalysisHistoryResponseSchema = z.object({
  items: z.array(MatchmakingAnalysisHistoryItemSchema),
});

export type MatchmakingAnalysisResults = z.infer<
  typeof MatchmakingAnalysisResultsSchema
>;
export type MatchmakingAnalysisStatus = z.infer<
  typeof MatchmakingAnalysisStatusSchema
>;
export type MatchmakingAnalysisResponse = z.infer<
  typeof MatchmakingAnalysisResponseSchema
>;
export type MatchmakingAnalysisHistoryItem = z.infer<
  typeof MatchmakingAnalysisHistoryItemSchema
>;
export type MatchmakingAnalysisHistoryResponse = z.infer<
  typeof MatchmakingAnalysisHistoryResponseSchema
>;

// ===== SMURF AND BOOST DETECTION SCHEMAS =====

export const SmurfBoostBandSchema = z.enum([
  "not_enough_data",
  "no_unusual_pattern",
  "weak_indicators",
  "notable_indicators",
  "strong_indicators",
]);

export const SmurfBoostConfidenceBandSchema = z.enum(["low", "medium", "high"]);

// The v1 engine emits exactly two families, but the wire contract types the
// field as a plain string. Rejecting an unknown family would fail the whole
// response and hide a valid result, so an unknown id is carried through and
// rendered as itself, the same way an unknown data-quality note is.
export const SmurfBoostFamilyIdSchema = z.string();

export const SmurfBoostStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "failed",
]);

// Smurf Boost Signal Schema
export const SmurfBoostSignalSchema = z.object({
  id: z.string(),
  family: SmurfBoostFamilyIdSchema,
  available: z.boolean(),
  triggered: z.boolean(),
  sample_size: z.number().int(),
  reason: z.string(),
  notes: z.array(z.string()),
  raw_value: z.number().nullable().optional(),
  threshold: z.number().nullable().optional(),
  saturation: z.number().nullable().optional(),
  magnitude: z.number().nullable().optional(),
  weight: z.number().nullable().optional(),
  contribution: z.number().nullable().optional(),
});

export type SmurfBoostSignal = z.infer<typeof SmurfBoostSignalSchema>;

// Smurf Boost Family Schema
export const SmurfBoostFamilySchema = z.object({
  family: SmurfBoostFamilyIdSchema,
  band: SmurfBoostBandSchema,
  distinct_evidence: z.number().int(),
  signals: z.array(SmurfBoostSignalSchema),
});

export type SmurfBoostFamily = z.infer<typeof SmurfBoostFamilySchema>;

// Smurf Boost Results Schema
export const SmurfBoostResultsSchema = z.object({
  model_version: z.string(),
  families: z.array(SmurfBoostFamilySchema),
  confidence: z.number(),
  confidence_band: SmurfBoostConfidenceBandSchema,
  recent_games: z.number().int(),
  baseline_games: z.number().int(),
  eligible_games: z.number().int(),
  notes: z.array(z.string()),
  disclaimer: z.string(),
});

export type SmurfBoostResults = z.infer<typeof SmurfBoostResultsSchema>;

// Smurf Boost Analysis Response Schema. Parsed permissively, then split on
// the lifecycle the same way a matchmaking run is: only the `completed`
// variant carries `results`, so rendering one without narrowing on `status`
// does not compile. See `splitRunOnLifecycle` above for why a `completed` run
// with no results is reported as `failed` instead of rejected.
export const SmurfBoostAnalysisResponseSchema = z
  .object({
    puuid: z.string(),
    created_at: z.string(),
    status: SmurfBoostStatusSchema,
    model_version: z.string(),
    thresholds: z.record(z.string(), z.number()),
    results: SmurfBoostResultsSchema.nullable().optional(),
    eligible_games: z.number().int(),
    latest_match_id: z.string().nullable().optional(),
    error_code: z.string().nullable().optional(),
    error_message: z.string().nullable().optional(),
    completed_at: z.string().nullable().optional(),
    is_stale: z.boolean().default(false),
  })
  .transform((run) => splitRunOnLifecycle<typeof run, SmurfBoostResults>(run));

export type SmurfBoostAnalysisResponse = z.infer<
  typeof SmurfBoostAnalysisResponseSchema
>;

// The named threshold sets the backend ships. Each one is emitted in the card
// settings write contract's own camelCase field names, so a client applies a
// preset by posting its thresholds back unchanged.
export const SmurfBoostPresetSchema = z.object({
  name: z.string(),
  thresholds: z.record(z.string(), z.number()),
});

export const SmurfBoostPresetsResponseSchema = z.object({
  default_preset: z.string(),
  presets: z.array(SmurfBoostPresetSchema),
});

export type SmurfBoostPreset = z.infer<typeof SmurfBoostPresetSchema>;
export type SmurfBoostPresetsResponse = z.infer<
  typeof SmurfBoostPresetsResponseSchema
>;

// One viewer's effective settings for one analytical card. `settings` carries
// the card's fixed values alongside its mutable ones, so a write must send
// back only the fields the write contract accepts. Values are not all numbers
// — Top Champions carries a role list — and this response returns every card,
// so a numeric-only shape here would reject the whole catalog.
/** The three analytical cards the settings API answers for, by its own ids. */
export const CardIdSchema = z.enum([
  "profile.top-champions",
  "profile.recent-performance",
  "profile.smurf-boost-detection",
]);
export type CardId = z.infer<typeof CardIdSchema>;

export const CardPreferenceSchema = z.object({
  cardId: CardIdSchema,
  version: z.literal(1),
  settings: z.record(z.string(), z.unknown()),
  isDefault: z.boolean(),
  requiresRecovery: z.boolean().default(false),
  updatedAt: z.string().nullable().optional(),
});

export type CardPreference = z.infer<typeof CardPreferenceSchema>;

export type SmurfBoostBand = z.infer<typeof SmurfBoostBandSchema>;
export type SmurfBoostConfidenceBand = z.infer<
  typeof SmurfBoostConfidenceBandSchema
>;
export type SmurfBoostStatus = z.infer<typeof SmurfBoostStatusSchema>;

// Riot credential health, as the header banner and the settings card each
// read it. Both used to declare their own copy next to the component, which
// put them outside `tests/api-contract-alignment.test.ts` -- the only check
// that compares a zod shape to what FastAPI actually serialises. Both copies
// said `z.number()` for a `health_revision` the API declares as an integer.
const credentialStatus = z.enum(["missing", "unknown", "valid", "invalid"]);

export const ServiceStatusSchema = z.object({
  is_under_maintenance: z.boolean(),
  reason: z.enum(["ok", "api_key_missing", "api_key_invalid"]),
  credential_status: credentialStatus,
  health_revision: z.number().int(),
  observed_at: z.string(),
  has_recent_recovery: z.boolean(),
  recovery_notice_key: z.string().nullable(),
});

export type ServiceStatus = z.infer<typeof ServiceStatusSchema>;
