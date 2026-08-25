import { queryOptions } from "@tanstack/react-query";

import { unwrap, validatedGet } from "@/lib/core/api";
import {
  MatchListWithPlayerDataResponseSchema,
  MatchStatsResponseSchema,
} from "@/lib/core/schemas";

// The roots of the two caches below, as constants rather than literals: the
// predicate at the bottom of this file has to recognise both, and a third
// hand-written copy is how the pair drifted onto different casing the last
// time. A rename is now a type error instead of a predicate that quietly
// matches nothing.
const MATCH_HISTORY_STATS_KEY = "match-history-stats";
const MATCH_HISTORY_DETAILED_KEY = "match-history-detailed";

/**
 * The two caches the Match History surface reads, named once — the same
 * arrangement every other data-bearing feature keeps in its `*-query.ts`.
 * The two literals this replaced had already drifted onto different casing
 * conventions.
 */
export function matchHistoryStatsQueryOptions(
  puuid: string,
  queueQueryParam: string | undefined,
) {
  return queryOptions({
    queryKey: [MATCH_HISTORY_STATS_KEY, puuid, queueQueryParam] as const,
    queryFn: async () =>
      unwrap(
        await validatedGet(
          MatchStatsResponseSchema,
          `/matches/player/${puuid}/stats`,
          { queues: queueQueryParam },
        ),
      ),
  });
}

export function matchHistoryDetailedQueryOptions(args: {
  puuid: string;
  queueQueryParam: string | undefined;
  search: string;
  page: number;
  pageSize: number;
}) {
  const { puuid, queueQueryParam, search, page, pageSize } = args;
  return queryOptions({
    queryKey: [
      MATCH_HISTORY_DETAILED_KEY,
      puuid,
      queueQueryParam,
      search,
      page,
      pageSize,
    ] as const,
    queryFn: async () =>
      unwrap(
        await validatedGet(
          MatchListWithPlayerDataResponseSchema,
          `/matches/player/${puuid}/detailed`,
          {
            queues: queueQueryParam,
            search: search || undefined,
            start: (page - 1) * pageSize,
            count: pageSize,
          },
        ),
      ),
  });
}

/**
 * Either of the two caches above, for one player, whatever its queue filter,
 * search, page or page size.
 *
 * A predicate rather than a key prefix because the two roots are siblings, not
 * a shared prefix, and `refetchQueries` takes one predicate.
 */
export function isMatchHistoryQuery(
  queryKey: readonly unknown[],
  puuid: string,
): boolean {
  return (
    (queryKey[0] === MATCH_HISTORY_STATS_KEY ||
      queryKey[0] === MATCH_HISTORY_DETAILED_KEY) &&
    queryKey[1] === puuid
  );
}
