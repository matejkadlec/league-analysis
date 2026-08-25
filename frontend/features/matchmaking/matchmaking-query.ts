import type { QueryClient } from "@tanstack/react-query";

/**
 * The four caches one matchmaking run touches, named once. The status key is
 * a prefix, one entry per watched run.
 */
export function matchmakingAnalysisQueryKey(puuid: string) {
  return ["matchmaking-analysis", puuid] as const;
}

export function matchmakingResultsQueryKey(puuid: string) {
  return ["matchmaking-analysis-results", puuid] as const;
}

export function matchmakingHistoryQueryKey(puuid: string) {
  return ["matchmaking-analysis-history", puuid] as const;
}

export function matchmakingStatusQueryKey(puuid: string) {
  return ["matchmaking-analysis-status", puuid] as const;
}

/** Refresh everything a finished, cancelled or deleted run changes. */
export async function invalidateMatchmakingRun(
  queryClient: QueryClient,
  puuid: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: matchmakingAnalysisQueryKey(puuid),
    }),
    queryClient.invalidateQueries({
      queryKey: matchmakingResultsQueryKey(puuid),
    }),
    queryClient.invalidateQueries({
      queryKey: matchmakingHistoryQueryKey(puuid),
    }),
  ]);
}
