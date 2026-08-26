import { z } from "zod";

export const MatchmakingAnalysisRequestSchema = z.object({
  puuid: z.string(),
  match_count: z.number().int(),
  end_date: z.string().nullable(),
});
export type MatchmakingAnalysisRequest = z.infer<
  typeof MatchmakingAnalysisRequestSchema
>;

import { splitRunOnLifecycle } from "./run-lifecycle";

// ===== MATCHMAKING ANALYSIS SCHEMAS =====

/** The parameters a run was started with; the backend echoes them on every
 * read, defaulting legacy rows to a 10-match latest-window run. */
export const MatchmakingAnalysisParamsSchema = z.object({
  match_count: z.number().int(),
  end_date: z.string().nullable(),
});

export const MatchmakingPerMatchSchema = z.object({
  match_id: z.string(),
  duo: z.boolean(),
  team_avg: z.number().min(0).max(1),
  enemy_avg: z.number().min(0).max(1),
});

export const MatchmakingRankFreshnessSchema = z.object({
  period_accurate: z.number().int().min(0),
  current_day: z.number().int().min(0),
});

/**
 * Every field beyond the original three is optional and read as
 * null-or-absent, never defaulted to a number: runs completed before the
 * rank/duo extension lack them, and a 0 here renders as "average rank
 * Iron IV" — the same class of bug as the 0% winrate the backend TypedDict
 * documents.
 */
export const MatchmakingAnalysisResultsSchema = z.object({
  team_avg_winrate: z.number().min(0).max(1),
  enemy_avg_winrate: z.number().min(0).max(1),
  matches_analyzed: z.number().int().min(0),
  matches_requested: z.number().int().nullable().optional(),
  ally_avg_rank_value: z.number().min(0).nullable().optional(),
  enemy_avg_rank_value: z.number().min(0).nullable().optional(),
  ally_tier_counts: z.record(z.string(), z.number().int()).nullable().optional(),
  enemy_tier_counts: z
    .record(z.string(), z.number().int())
    .nullable()
    .optional(),
  per_match: z.array(MatchmakingPerMatchSchema).nullable().optional(),
  rank_freshness: MatchmakingRankFreshnessSchema.nullable().optional(),
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
 * One schema for every matchmaking run the API returns, `/status` included.
 */
export const MatchmakingAnalysisResponseSchema = z
  .object({
    puuid: z.string(),
    status: MatchmakingAnalysisStatusSchema,
    progress: z.number().int(),
    total_puuids: z.number().int(),
    results: MatchmakingAnalysisResultsSchema.nullable().optional(),
    params: MatchmakingAnalysisParamsSchema,
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
  params: MatchmakingAnalysisParamsSchema,
});

export const MatchmakingAnalysisHistoryResponseSchema = z.object({
  items: z.array(MatchmakingAnalysisHistoryItemSchema),
});

export type MatchmakingAnalysisParams = z.infer<
  typeof MatchmakingAnalysisParamsSchema
>;
export type MatchmakingPerMatch = z.infer<typeof MatchmakingPerMatchSchema>;
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
