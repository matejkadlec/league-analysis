import { queryOptions } from "@tanstack/react-query";
import { ApiRequestError } from "@/lib/core/api";

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

      const result = await getLatestSmurfBoostDetection(puuid);
      if (!result.success) {
        // A player who has never been analysed is an ordinary empty state,
        // not a failure the card should report as an error.
        if (result.error.status === 404) {
          return null;
        }
        throw new ApiRequestError(result.error);
      }
      return result.data;
    },
    enabled: !!puuid,
    retry: false,
    staleTime: 30000,
    // SmurfBoostDetection renders this failure inline as a destructive alert.
    meta: { silenceErrorToast: true },
  });
}
