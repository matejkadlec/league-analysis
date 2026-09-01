"use client";

import { useQuery } from "@tanstack/react-query";

import { unwrap, validatedGet } from "@/lib/core/http/api";
import { PlayerLeagueSchema } from "@/lib/core/schemas";

/**
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
          { signal },
        ),
      ),
    retry: false,
    // A rank moves on the order of a match; `handleRefreshAll` invalidates this key.
    staleTime: 60000,
  });
}
