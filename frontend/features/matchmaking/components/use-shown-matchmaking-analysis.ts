"use client";

import { useQuery } from "@tanstack/react-query";
import { unwrapOr404 } from "@/lib/core/http/api";

import {
  getLatestCompletedMatchmakingAnalysis,
  getMatchmakingAnalysisStatus,
} from "../matchmaking-api";
import { matchmakingResultsQueryKey } from "../matchmaking-query";

/**
 * The run on screen: the one picked out of the history, else the latest
 * completed. The history card shares this cache entry, so the two agree.
 */
export function useShownMatchmakingAnalysis(
  puuid: string,
  selectedCreatedAt: string | null,
) {
  return useQuery({
    // The picked run is part of the cache identity, and the factory stays the
    // prefix `invalidateMatchmakingRun` refreshes.
    queryKey: [...matchmakingResultsQueryKey(puuid), selectedCreatedAt],
    queryFn: async ({ signal }) => {
      return unwrapOr404(
        selectedCreatedAt
          ? await getMatchmakingAnalysisStatus(puuid, selectedCreatedAt, signal)
          : await getLatestCompletedMatchmakingAnalysis(puuid, signal),
        null,
      );
    },
    retry: false,
    staleTime: 30000,
  });
}
