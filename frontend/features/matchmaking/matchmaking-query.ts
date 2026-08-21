import type { QueryClient } from "@tanstack/react-query";

/**
 * The four caches one matchmaking run touches, named once.
 *
 * They used to be inline literals across five files, and the set a write
 * invalidated was copied by hand into three of them -- which had already gone
 * wrong: deleting a history record refreshed the results and the history but
 * not the latest-run card above them, so the card went on offering "Run New
 * Analysis" for a record that no longer existed. The fix at the time was a
 * fourth hand-copy. `invalidateMatchmakingRun` is that list, in one place.
 *
 * The status key is a prefix: the poll extends it with the run's `createdAt`
 * so each watched run gets its own cache entry, while `removeQueries` on the
 * prefix drops every one of them when the watch ends.
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
