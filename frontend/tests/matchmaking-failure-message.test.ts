import { describe, expect, it } from "vitest";

import { analysisFailureMessage } from "@/features/matchmaking/components/matchmaking-analysis-state";
import { MatchmakingAnalysisResponseSchema } from "@/lib/core/schemas";

function failed(error_code: string, error_message: string | null = null) {
  return MatchmakingAnalysisResponseSchema.parse({
    puuid: "puuid-1",
    status: "failed",
    progress: 0,
    total_puuids: 0,
    created_at: "2026-08-21T00:00:00Z",
    error_code,
    error_message,
    requests_saved: 0,
    params: { match_count: 10, end_date: null },
  });
}

describe("analysisFailureMessage", () => {
  it("keeps the count the backend put in the not_enough_matches message", () => {
    // Nearly every player in this dataset has under ten ranked games, so this
    // is the failure the feature produces most often. The generic sentence
    // loses the one number that tells the viewer how far off they are.
    expect(
      analysisFailureMessage(
        failed(
          "not_enough_matches",
          "Player doesn't have enough ranked matches for this analysis. Found 4, need 10.",
        ),
      ),
    ).toContain("Found 4");
  });

  it("still explains not_enough_matches when the backend sent no message", () => {
    expect(analysisFailureMessage(failed("not_enough_matches"))).toContain(
      "enough ranked matches",
    );
  });

  it("names the two other refusals the backend can send", () => {
    expect(analysisFailureMessage(failed("player_not_in_match"))).toContain(
      "could not be verified",
    );
    expect(analysisFailureMessage(failed("no_matches_analyzed"))).toContain(
      "No ranked match history",
    );
  });

  it("falls back for a code it does not know", () => {
    expect(analysisFailureMessage(failed("something_new"))).toBe(
      "The analysis did not finish. Please try again.",
    );
  });
});
