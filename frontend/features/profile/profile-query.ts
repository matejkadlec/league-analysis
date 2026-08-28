import { queryOptions } from "@tanstack/react-query";

import { RANKED_SOLO_QUEUE_ID } from "@/lib/core/queue-catalog";
import { unwrap, validatedGet } from "@/lib/core/api";
import {
  ChampionStatsResponseSchema,
  LaneStatsResponseSchema,
} from "@/lib/core/schemas";

/**
 * The two aggregate reads behind the profile cards, owned by the feature the
 * way `playerStatsQueryOptions` already owns the recent-performance read —
 * the overview route composes cards, it does not decide what they fetch.
 */
export function championStatsQueryOptions(puuid: string) {
  return queryOptions({
    queryKey: ["champion-stats", puuid, RANKED_SOLO_QUEUE_ID],
    queryFn: async ({ signal }) =>
      unwrap(
        await validatedGet(
          ChampionStatsResponseSchema,
          `/matches/player/${puuid}/champion-stats`,
          { params: { queues: String(RANKED_SOLO_QUEUE_ID) }, signal },
        ),
      ),
  });
}

export function laneStatsQueryOptions(puuid: string) {
  return queryOptions({
    queryKey: ["lane-stats", puuid, RANKED_SOLO_QUEUE_ID],
    queryFn: async ({ signal }) =>
      unwrap(
        await validatedGet(
          LaneStatsResponseSchema,
          `/matches/player/${puuid}/lane-stats`,
          { params: { queues: String(RANKED_SOLO_QUEUE_ID) }, signal },
        ),
      ),
  });
}
