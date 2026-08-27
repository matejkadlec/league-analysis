import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import {
  invalidateMatchmakingRun,
  matchmakingAnalysisQueryKey,
  matchmakingHistoryQueryKey,
  matchmakingResultsQueryKey,
  matchmakingStatusQueryKey,
} from "@/features/matchmaking/matchmaking-query";

describe("the matchmaking cache keys", () => {
  it("names each cache with its root and the player it belongs to", () => {
    // Five components index these caches by hand; one player's run must
    // never be readable as another's, so every key carries the puuid.
    expect(matchmakingAnalysisQueryKey("player-puuid")).toEqual([
      "matchmaking-analysis",
      "player-puuid",
    ]);
    expect(matchmakingResultsQueryKey("player-puuid")).toEqual([
      "matchmaking-analysis-results",
      "player-puuid",
    ]);
    expect(matchmakingHistoryQueryKey("player-puuid")).toEqual([
      "matchmaking-analysis-history",
      "player-puuid",
    ]);
    expect(matchmakingStatusQueryKey("player-puuid")).toEqual([
      "matchmaking-analysis-status",
      "player-puuid",
    ]);
  });
});

describe("invalidateMatchmakingRun", () => {
  it("refreshes everything a finished or deleted run changes, for that player only", async () => {
    const queryClient = new QueryClient();
    for (const key of [
      matchmakingAnalysisQueryKey("player-puuid"),
      matchmakingResultsQueryKey("player-puuid"),
      matchmakingHistoryQueryKey("player-puuid"),
      matchmakingAnalysisQueryKey("other-puuid"),
    ]) {
      queryClient.setQueryData(key, "seed");
    }

    await invalidateMatchmakingRun(queryClient, "player-puuid");

    expect(
      queryClient.getQueryState(matchmakingAnalysisQueryKey("player-puuid"))
        ?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(matchmakingResultsQueryKey("player-puuid"))
        ?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(matchmakingHistoryQueryKey("player-puuid"))
        ?.isInvalidated,
    ).toBe(true);
    // A run that ends for one player says nothing about another's.
    expect(
      queryClient.getQueryState(matchmakingAnalysisQueryKey("other-puuid"))
        ?.isInvalidated,
    ).toBe(false);
  });

  it("leaves the status cache to the watcher that owns it", async () => {
    // The status key is written and removed by the session watching one run:
    // invalidating it here would refetch a run the other caches just
    // learned is over.
    const queryClient = new QueryClient();
    queryClient.setQueryData(
      matchmakingStatusQueryKey("player-puuid"),
      "seed",
    );

    await invalidateMatchmakingRun(queryClient, "player-puuid");

    expect(
      queryClient.getQueryState(matchmakingStatusQueryKey("player-puuid"))
        ?.isInvalidated,
    ).toBe(false);
  });
});
