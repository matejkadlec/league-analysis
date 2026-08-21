import {
  queryOptions,
  skipToken,
  type QueryClient,
} from "@tanstack/react-query";

import { unwrap, validatedGet } from "@/lib/core/api";
import { MatchStatsResponseSchema, PlayerSchema } from "@/lib/core/schemas";
import { RANKED_SOLO_QUEUE_ID } from "@/features/matches/queue-catalog";

export function playerQueryKey(puuid: string | null) {
  return ["player", puuid] as const;
}

export function trackedPlayersQueryKey(userId: number | null | undefined) {
  return ["tracked-players", userId] as const;
}

/** Invalidate everything that reflects whether a player is tracked. Track and
 * untrack both touch the same four caches; this names that set once. */
export function invalidateTrackingQueries(
  queryClient: QueryClient,
  userId: number | null | undefined,
  puuid: string,
): void {
  void queryClient.invalidateQueries({
    queryKey: trackedPlayersQueryKey(userId),
  });
  void queryClient.invalidateQueries({ queryKey: ["player-context", userId] });
  void queryClient.invalidateQueries({ queryKey: playerQueryKey(puuid) });
}

export function playerQueryOptions(puuid: string | null) {
  return queryOptions({
    queryKey: playerQueryKey(puuid),
    // `skipToken` rather than `enabled: !!puuid` plus an unreachable throw:
    // `enabled` is an ordinary option, so a caller spreading these options and
    // setting its own `enabled` drops the guard -- `player-context.tsx` does
    // exactly that, and only re-establishes it by coincidence. On `queryFn`
    // the guard cannot be spread away.
    queryFn: puuid
      ? async () => unwrap(await validatedGet(PlayerSchema, `/players/${puuid}`))
      : skipToken,
    retry: false,
  });
}

/**
 * Ranked Solo/Duo stats for one player, over their whole history or the last
 * `limit` games.
 *
 * The player card and the recent-performance card both mount on the overview
 * page, and their unlimited variants were two query keys issuing the byte-
 * identical request -- so every visit to that page fetched the same
 * aggregate twice. One key, one round trip.
 */
export function playerStatsQueryOptions(puuid: string, limit?: number) {
  return queryOptions({
    queryKey: ["player-stats", puuid, RANKED_SOLO_QUEUE_ID, limit ?? null],
    queryFn: async () =>
      unwrap(
        await validatedGet(
          MatchStatsResponseSchema,
          `/matches/player/${puuid}/stats`,
          limit === undefined
            ? { queue: RANKED_SOLO_QUEUE_ID }
            : { queue: RANKED_SOLO_QUEUE_ID, limit },
        ),
      ),
    retry: false,
  });
}
