import {
  queryOptions,
  skipToken,
  type QueryClient,
} from "@tanstack/react-query";

import { unwrap, validatedGet } from "@/lib/core/api";
import { MatchStatsResponseSchema, PlayerSchema } from "@/lib/core/schemas";
import { RANKED_SOLO_QUEUE_ID } from "@/features/matches";

export function playerQueryKey(puuid: string | null) {
  return ["player", puuid] as const;
}

export function trackedPlayersQueryKey(userId: number | null | undefined) {
  return ["tracked-players", userId] as const;
}

/** The account's player-context cache (`/players/context`), owned by
 * `player-context.tsx`; named here so every write spells it from one place. */
export function playerContextQueryKey(userId: number | null | undefined) {
  return ["player-context", userId] as const;
}

/** The suggestion caches `player-selector.tsx` reads; it keys full searches on
 * this prefix and invalidates the whole family by it. An array, not a bare
 * string, so query-key-scope-contract.test.ts can read the namespace here. */
export const PLAYER_SUGGESTIONS_QUERY_KEY = ["player-suggestions"] as const;

/** Invalidate everything that reflects whether a player is tracked, awaiting
 * every invalidation the way `invalidateMatchmakingRun` does. Track and
 * untrack both touch the same three caches; this names that set once. */
export async function invalidateTrackingQueries(
  queryClient: QueryClient,
  userId: number | null | undefined,
  puuid: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: trackedPlayersQueryKey(userId),
    }),
    queryClient.invalidateQueries({
      queryKey: playerContextQueryKey(userId),
    }),
    queryClient.invalidateQueries({ queryKey: playerQueryKey(puuid) }),
  ]);
}

export function playerQueryOptions(puuid: string | null) {
  return queryOptions({
    queryKey: playerQueryKey(puuid),
    // `skipToken` rather than `enabled: !!puuid`: `enabled` is an ordinary
    // option, so a caller spreading these options and setting its own drops
    // the guard -- on `queryFn` the guard cannot be spread away.
    queryFn: puuid
      ? async ({ signal }) =>
          unwrap(
            await validatedGet(
              PlayerSchema,
              `/players/${puuid}`,
              undefined,
              signal,
            ),
          )
      : skipToken,
    // The copy `player-context.tsx` seeds from `/players/context` is only
    // worth seeding while it counts as fresh: at `staleTime: 0` every route
    // refetches a player it was just handed. Invalidation beats `staleTime`.
    staleTime: 60_000,
    retry: false,
  });
}

/**
 * Ranked Solo/Duo stats for one player, over their whole history or the last
 * `limit` games. The player card and the recent-performance card share this
 * key, so their unlimited variants are one round trip.
 */
export function playerStatsQueryOptions(puuid: string, limit?: number) {
  return queryOptions({
    queryKey: ["player-stats", puuid, RANKED_SOLO_QUEUE_ID, limit ?? null],
    queryFn: async ({ signal }) =>
      unwrap(
        await validatedGet(
          MatchStatsResponseSchema,
          `/matches/player/${puuid}/stats`,
          {
            // `queues`, not the scalar `queue`: a name this endpoint does not
            // declare is dropped rather than refused, which would leave the
            // card averaging every queue.
            queues: String(RANKED_SOLO_QUEUE_ID),
            ...(limit !== undefined && { limit }),
          },
          signal,
        ),
      ),
    retry: false,
  });
}
