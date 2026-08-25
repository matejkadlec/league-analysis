import { describe, expect, it } from "vitest";

import { JobExecutionSchema } from "@/lib/core/schemas";

/**
 * Zod parses the bytes FastAPI actually sends: every other jobs test builds a
 * `JobExecution` typed against this schema and so can never disagree with it.
 * These payloads are `JobExecutionResponse.model_dump_json()` output, copied
 * verbatim.
 */
const PAYLOADS = {
  "a single call and a grouped one": `{"id":1,"job_config_id":2,"started_at":"2026-08-20T23:42:55.547593Z","completed_at":null,"status":"SUCCESS","api_requests_made":4,"records_created":0,"records_updated":0,"error_message":null,"execution_log":{},"detailed_logs":{"logs":[{"event":"x"}],"api_calls":[{"endpoint":"/lol/match/v5/matches/EUW1_1","region":"europe","count":1,"first_timestamp":"2026-08-21T00:00:00","last_timestamp":"2026-08-21T00:00:00","params":{"matchId":"EUW1_1"},"param_key":null,"first_param":null,"last_param":null},{"endpoint":"/lol/match/v5/matches/by-puuid","region":"europe","count":3,"first_timestamp":"2026-08-21T00:00:00","last_timestamp":"2026-08-21T00:00:02","params":null,"param_key":"puuid","first_param":"p1","last_param":"p3"}]},"triggered_by":"system","has_api_key_error":false,"execution_type":"REGULAR"}`,
  "logs but no API calls": `{"id":1,"job_config_id":2,"started_at":"2026-08-20T23:42:55.547593Z","completed_at":null,"status":"SUCCESS","api_requests_made":4,"records_created":0,"records_updated":0,"error_message":null,"execution_log":{},"detailed_logs":{"logs":[{"event":"x"}],"api_calls":[]},"triggered_by":"system","has_api_key_error":false,"execution_type":"REGULAR"}`,
  "a legacy row stored before this shape existed": `{"id":1,"job_config_id":2,"started_at":"2026-08-20T23:42:55.547593Z","completed_at":null,"status":"SUCCESS","api_requests_made":4,"records_created":0,"records_updated":0,"error_message":null,"execution_log":{},"detailed_logs":{"logs":[],"api_calls":[]},"triggered_by":"system","has_api_key_error":false,"execution_type":"REGULAR"}`,
  "no detailed logs at all": `{"id":1,"job_config_id":2,"started_at":"2026-08-20T23:42:55.547593Z","completed_at":null,"status":"SUCCESS","api_requests_made":4,"records_created":0,"records_updated":0,"error_message":null,"execution_log":{},"detailed_logs":null,"triggered_by":"system","has_api_key_error":false,"execution_type":"REGULAR"}`,
};

describe("a job execution as the API serialises it", () => {
  it.each(Object.entries(PAYLOADS))("parses %s", (_name, payload) => {
    const parsed = JobExecutionSchema.safeParse(JSON.parse(payload));

    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
  });

  it("keeps the variant an entry is not, rather than dropping it", () => {
    const parsed = JobExecutionSchema.parse(
      JSON.parse(PAYLOADS["a single call and a grouped one"]),
    );
    const [single, grouped] = parsed.detailed_logs?.api_calls ?? [];

    expect(single?.params).toEqual({ matchId: "EUW1_1" });
    expect(single?.param_key).toBeNull();
    expect(grouped?.params).toBeNull();
    expect(grouped?.param_key).toBe("puuid");
  });
});
