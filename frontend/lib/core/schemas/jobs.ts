import { z } from "zod";

import { paginationFields } from "./common";

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
  // Resolved server-side (config_json overrides schedule); the card renders
  // this and never re-parses the schedule string. Null means the stored row
  // cannot name its interval; optional so a not-yet-redeployed backend
  // degrades to the schedule fallback instead of failing validation.
  interval_seconds: z.number().int().nullable().optional(),
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
export type JobStatus = z.infer<typeof JobStatusSchema>;
export type JobConfiguration = z.infer<typeof JobConfigurationSchema>;
export type JobExecution = z.infer<typeof JobExecutionSchema>;
export type JobExecutionApiCall = z.infer<typeof JobExecutionApiCallSchema>;
export type JobStatusResponse = z.infer<typeof JobStatusResponseSchema>;
export type JobControlActionResponse = z.infer<
  typeof JobControlActionResponseSchema
>;
export type JobExecutionListResponse = z.infer<
  typeof JobExecutionListResponseSchema
>;

// ===== PLAYER LEAGUE SCHEMA =====
// Simplified immutable league snapshot (ordered by created_at DESC for current)
