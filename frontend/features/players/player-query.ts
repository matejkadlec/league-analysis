import {
  queryOptions,
  skipToken,
  type QueryClient,
} from "@tanstack/react-query";

import { unwrap, validatedGet } from "@/lib/core/http/api";
import { MatchStatsResponseSchema, PlayerSchema } from "@/lib/core/schemas";
import { RANKED_SOLO_QUEUE_ID } from "@/lib/core/riot/queue-catalog";

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

/** The prefix `player-selector.tsx` keys searches on and invalidates by; an array,
 * not a bare string, so query-key-scope-contract.test.ts can read the namespace. */
export const PLAYER_SUGGESTIONS_QUERY_KEY = ["player-suggestions"] as const;

/** Track and untrack touch the same three caches; this names that set once, and
 * awaits every invalidation. */
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
    // `skipToken`, not `enabled: !!puuid`: a caller spreading these options and
    // setting its own `enabled` would drop the guard.
    queryFn: puuid
      ? async ({ signal }) =>
          unwrap(
            await validatedGet(PlayerSchema, `/players/${puuid}`, { signal }),
          )
      : skipToken,
    // At `staleTime: 0` every route refetches the player `player-context.tsx` just
    // seeded; invalidation, not staleness, is what retires that copy.
    staleTime: 60_000,
    retry: false,
  });
}

/**
 * The player card and the recent-performance card share this key, so their
 * unlimited variants are one round trip.
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
            params: {
              // `queues`, not the scalar `queue`: an undeclared name is dropped
              // rather than refused, leaving the card averaging every queue.
              queues: String(RANKED_SOLO_QUEUE_ID),
              ...(limit !== undefined && { limit }),
            },
            signal,
          },
        ),
      ),
    retry: false,
  });
}
