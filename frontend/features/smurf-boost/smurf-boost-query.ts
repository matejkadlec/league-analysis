import { queryOptions } from "@tanstack/react-query";
import { unwrapOr404 } from "@/lib/core/api";

import { getLatestSmurfBoostDetection } from "./smurf-boost-api";

export function smurfBoostQueryKey(puuid: string | null) {
  return ["smurf-boost-detection", puuid] as const;
}

export function smurfBoostQueryOptions(puuid: string | null) {
  return queryOptions({
    queryKey: smurfBoostQueryKey(puuid),
    queryFn: async () => {
      if (!puuid) {
        throw new Error("A player PUUID is required.");
      }

      return unwrapOr404(await getLatestSmurfBoostDetection(puuid), null);
    },
    enabled: !!puuid,
    retry: false,
    staleTime: 30000,
    // SmurfBoostDetection renders this failure inline as a destructive alert.
    meta: { silenceErrorToast: true },
  });
}
