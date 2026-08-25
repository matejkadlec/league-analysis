import { z } from "zod";

export const MatchmakingAnalysisRequestSchema = z.object({
  puuid: z.string(),
});
export type MatchmakingAnalysisRequest = z.infer<
  typeof MatchmakingAnalysisRequestSchema
>;

import { splitRunOnLifecycle } from "./run-lifecycle";

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
 * One schema for every matchmaking run the API returns. `/status` had its own,
 * differing only by a `puuid_progress` map nothing read, typed to accept a
 * string against a `dict[str, bool]` column that cannot hold one. The server
 * excludes the field now.
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
