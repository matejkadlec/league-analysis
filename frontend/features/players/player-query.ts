import { queryOptions, type QueryClient } from "@tanstack/react-query";

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
    queryFn: async () => {
      if (!puuid) {
        throw new Error("A player PUUID is required.");
      }

      return unwrap(await validatedGet(PlayerSchema, `/players/${puuid}`));
    },
    enabled: !!puuid,
    retry: false,
  });
}
