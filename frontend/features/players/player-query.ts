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

/** The suggestion caches `player-selector.tsx` reads; it keys full searches
 * on this prefix and invalidates the whole family by it after a selection.
 * An array, not a bare string, so query-key-scope-contract.test.ts can read
 * the namespace here. */
export const PLAYER_SUGGESTIONS_QUERY_KEY = ["player-suggestions"] as const;

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
  void queryClient.invalidateQueries({
    queryKey: playerContextQueryKey(userId),
  });
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
      ? async () =>
          unwrap(await validatedGet(PlayerSchema, `/players/${puuid}`))
      : skipToken,
    // The copy `player-context.tsx` seeds from `/players/context` is only
    // worth seeding while it counts as fresh: at `staleTime: 0` the seeded row
    // is stale the instant it lands and every route refetches a player it was
    // just handed. `components/providers.tsx` already defaults queries to a
    // minute, so this changes nothing today -- it is here because that default
    // is now load-bearing for a behaviour two files away, and lowering it
    // would quietly reintroduce the request without failing anything.
    //
    // Correctness does not depend on the window: a sync invalidates and
    // refetches every key carrying the PUUID, and tracking changes invalidate
    // this key by name. Invalidation beats `staleTime`.
    staleTime: 60_000,
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
          {
            // `queues`, not the scalar `queue` this endpoint used to accept as
            // well. A single-member union is the same filter -- the parser
            // answers `(420,)` either way -- and a name the endpoint does not
            // declare is dropped rather than refused, which would have made
            // this card quietly average every queue.
            queues: String(RANKED_SOLO_QUEUE_ID),
            ...(limit !== undefined && { limit }),
          },
        ),
      ),
    retry: false,
  });
}
