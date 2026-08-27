"use client";

import { useQuery } from "@tanstack/react-query";

import { unwrap, validatedGet } from "@/lib/core/api";
import { PlayerLeagueSchema } from "@/lib/core/schemas";

/**
 * The player's current ranked-solo standing, or `null` when they have none.
 * `/players/{puuid}/league` never 404s -- unranked is a 200 carrying `null` --
 * so a failure reaches the `QueryCache` toast rather than reading as unranked.
 */
export function usePlayerLeague(puuid: string) {
  return useQuery({
    queryKey: ["player-league", puuid],
    queryFn: async ({ signal }) =>
      unwrap(
        await validatedGet(
          PlayerLeagueSchema.nullable(),
          `/players/${puuid}/league`,
          undefined,
          signal,
        ),
      ),
    retry: false,
    // Both callers can be on screen at once, and a rank moves on the order of a
    // match, not a render. `handleRefreshAll` invalidates this key, so a sync
    // still shows its new rank immediately.
    staleTime: 60000,
  });
}
