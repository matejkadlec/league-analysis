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
    // A rank moves on the order of a match; `PLAYER_DERIVED_SYNC_ROOTS` in
    // `use-player-sync-run.ts` is what retires this key after an update.
    staleTime: 60000,
  });
}
