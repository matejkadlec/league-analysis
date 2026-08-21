import {
  queryOptions,
  skipToken,
  type QueryClient,
} from "@tanstack/react-query";

import { unwrap, validatedGet } from "@/lib/core/api";
import { PlayerSchema } from "@/lib/core/schemas";

export function playerQueryKey(puuid: string | null) {
  return ["player", puuid] as const;
}

/** Invalidate everything that reflects whether a player is tracked. Track and
 * untrack both touch the same four caches; this names that set once. */
export function invalidateTrackingQueries(
  queryClient: QueryClient,
  userId: number | null | undefined,
  puuid: string,
): void {
  void queryClient.invalidateQueries({
    queryKey: ["tracking-status", userId, puuid],
  });
  void queryClient.invalidateQueries({ queryKey: ["tracked-players", userId] });
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
