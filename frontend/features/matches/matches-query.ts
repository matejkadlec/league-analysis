import { queryOptions } from "@tanstack/react-query";

import { unwrap, validatedGet } from "@/lib/core/api";
import {
  MatchListWithPlayerDataResponseSchema,
  MatchStatsResponseSchema,
} from "@/lib/core/schemas";

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
    queryKey: ["match-history-stats", puuid, queueQueryParam] as const,
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
      "match-history-detailed",
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
