import { describe, expect, it } from "vitest";

import {
  MatchmakingAnalysisResponseSchema,
  SmurfBoostAnalysisResponseSchema,
} from "@/lib/core/schemas";

/**
 * A run poll answers 200 whatever the outcome, so the lifecycle field is the
 * only thing separating a result from a failure. Only the `completed` variant
 * carries `results`; what is asserted here is the runtime half of that split.
 */

const matchmakingResults = {
  team_avg_winrate: 0.51,
  enemy_avg_winrate: 0.49,
  matches_analyzed: 120,
};

function matchmakingPayload(overrides: Record<string, unknown>) {
  return {
    puuid: "PUUID",
    status: "completed",
    progress: 10,
    total_puuids: 10,
    created_at: "2026-08-15T00:00:00Z",
    requests_saved: 0,
    params: { match_count: 10, end_date: null },
    ...overrides,
  };
}

describe("matchmaking run lifecycle split", () => {
  it("accepts a completed run whose tier counts name only occupied tiers", () => {
    // Zod 4 `z.record(enum)` requires every member; the backend emits a Counter.
    const run = MatchmakingAnalysisResponseSchema.parse(
      matchmakingPayload({
        results: {
          ...matchmakingResults,
          ally_tier_counts: { GOLD: 3 },
          enemy_tier_counts: { UNRANKED: 2, PLATINUM: 1 },
        },
      }),
    );

    expect(run.status).toBe("completed");
    expect(run.status === "completed" && run.results?.ally_tier_counts).toEqual({
      GOLD: 3,
    });
  });

  it("keeps results on a completed run", () => {
    const run = MatchmakingAnalysisResponseSchema.parse(
      matchmakingPayload({ results: matchmakingResults }),
    );

    expect(run.status).toBe("completed");
    expect(run.status === "completed" && run.results).toEqual(
      matchmakingResults,
    );
  });

  it("reports a completed run with no results as failed", () => {
    const run = MatchmakingAnalysisResponseSchema.parse(
      matchmakingPayload({ results: null }),
    );

    expect(run.status).toBe("failed");
    expect(run.error_code).toBe("results_missing");
    expect("results" in run).toBe(false);
  });

  it("does not attach results to a run that is still in flight", () => {
    const run = MatchmakingAnalysisResponseSchema.parse(
      matchmakingPayload({ status: "in_progress", results: null }),
    );

    expect(run.status).toBe("in_progress");
    expect("results" in run).toBe(false);
  });

  it("strips results a run in flight should never have carried", () => {
    // The type cannot express this one: a card holding a run typed as
    // in-flight has no `results` key to read, so only the runtime split can
    // say what happens when a row carries partial averages anyway.
    const run = MatchmakingAnalysisResponseSchema.parse(
      matchmakingPayload({ status: "in_progress", results: matchmakingResults }),
    );

    expect(run.status).toBe("in_progress");
    expect("results" in run).toBe(false);
  });

  it("preserves a genuine failure untouched", () => {
    const run = MatchmakingAnalysisResponseSchema.parse(
      matchmakingPayload({
        status: "failed",
        results: null,
        error_code: "analysis_failed",
        error_message: "The analysis did not finish.",
      }),
    );

    expect(run.status).toBe("failed");
    expect(run.error_code).toBe("analysis_failed");
    expect(run.error_message).toBe("The analysis did not finish.");
  });
});

describe("smurf and boost run lifecycle split", () => {
  const smurfResults = {
    model_version: "1.0.0",
    families: [],
    confidence: 0.4,
    confidence_band: "medium",
    recent_games: 20,
    baseline_games: 40,
    eligible_games: 60,
    notes: [],
    disclaimer: "Not a verdict.",
  };

  function smurfPayload(overrides: Record<string, unknown>) {
    return {
      puuid: "PUUID",
      created_at: "2026-08-15T00:00:00Z",
      status: "completed",
      model_version: "1.0.0",
      thresholds: { recent_window: 20 },
      eligible_games: 60,
      ...overrides,
    };
  }

  it("keeps results on a completed run", () => {
    const run = SmurfBoostAnalysisResponseSchema.parse(
      smurfPayload({ results: smurfResults }),
    );

    expect(run.status).toBe("completed");
    expect(run.status === "completed" && run.results.confidence).toBe(0.4);
  });

  it("reports a completed run with no results as failed", () => {
    const run = SmurfBoostAnalysisResponseSchema.parse(
      smurfPayload({ results: null }),
    );

    expect(run.status).toBe("failed");
    expect(run.error_code).toBe("results_missing");
    expect("results" in run).toBe(false);
  });

  it("replaces a stale error message along with the code", () => {
    // The smurf card renders `error_message` verbatim for any failed run, so
    // keeping a legacy row's message would describe a different failure than
    // the code names.
    const run = SmurfBoostAnalysisResponseSchema.parse(
      smurfPayload({
        results: null,
        error_code: "provider_error",
        error_message: "Riot unavailable",
      }),
    );

    expect(run.status).toBe("failed");
    expect(run.error_code).toBe("results_missing");
    expect(run.error_message).not.toBe("Riot unavailable");
    expect(run.error_message).toContain("no results");
  });

  it("does not attach results to a run that is still in flight", () => {
    const run = SmurfBoostAnalysisResponseSchema.parse(
      smurfPayload({ status: "in_progress", results: null }),
    );

    expect(run.status).toBe("in_progress");
    expect("results" in run).toBe(false);
  });
});
