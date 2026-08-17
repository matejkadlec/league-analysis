import { queryOptions } from "@tanstack/react-query";

import { unwrap, validatedGet } from "@/lib/core/api";
import { PlayerSchema } from "@/lib/core/schemas";

export function playerQueryKey(puuid: string | null) {
  return ["player", puuid] as const;
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
