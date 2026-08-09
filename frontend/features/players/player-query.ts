import { queryOptions } from "@tanstack/react-query";

import { validatedGet } from "@/lib/core/api";
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

      const result = await validatedGet(PlayerSchema, `/players/${puuid}`);
      if (!result.success) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    enabled: !!puuid,
    retry: false,
  });
}
