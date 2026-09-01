import { z } from "zod";

export const SmurfBoostAnalysisRequestSchema = z.object({
  puuid: z.string(),
});
export type SmurfBoostAnalysisRequest = z.infer<
  typeof SmurfBoostAnalysisRequestSchema
>;

import { splitRunOnLifecycle } from "./run-lifecycle";

export const SmurfBoostBandSchema = z.enum([
  "not_enough_data",
  "no_unusual_pattern",
  "weak_indicators",
  "notable_indicators",
  "strong_indicators",
]);

export const SmurfBoostConfidenceBandSchema = z.enum(["low", "medium", "high"]);

// A plain string on the wire: rejecting an unknown family would fail the whole
// response, so an unknown id is carried through and rendered as itself.
export const SmurfBoostFamilyIdSchema = z.string();

export const SmurfBoostStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "failed",
]);

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

export const SmurfBoostFamilySchema = z.object({
  family: SmurfBoostFamilyIdSchema,
  band: SmurfBoostBandSchema,
  distinct_evidence: z.number().int(),
  signals: z.array(SmurfBoostSignalSchema),
});

export type SmurfBoostFamily = z.infer<typeof SmurfBoostFamilySchema>;

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

// Parsed permissively, then split on the lifecycle: only the `completed`
// variant carries `results`. See `splitRunOnLifecycle` in ./run-lifecycle.
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

// Thresholds arrive in the settings write contract's own camelCase names, so a
// preset applies by posting them back unchanged.
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

export type SmurfBoostBand = z.infer<typeof SmurfBoostBandSchema>;
export type SmurfBoostConfidenceBand = z.infer<
  typeof SmurfBoostConfidenceBandSchema
>;
