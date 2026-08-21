import { z } from "zod";

export const SmurfBoostAnalysisRequestSchema = z.object({
  puuid: z.string(),
});
export type SmurfBoostAnalysisRequest = z.infer<
  typeof SmurfBoostAnalysisRequestSchema
>;

import { splitRunOnLifecycle } from "./run-lifecycle";

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
// does not compile. See `splitRunOnLifecycle` in ./run-lifecycle for why a
// `completed` run with no results is reported as `failed` instead of rejected.
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

export type SmurfBoostBand = z.infer<typeof SmurfBoostBandSchema>;
export type SmurfBoostConfidenceBand = z.infer<
  typeof SmurfBoostConfidenceBandSchema
>;
