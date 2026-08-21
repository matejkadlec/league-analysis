import { queryOptions } from "@tanstack/react-query";
import { unwrapOr404 } from "@/lib/core/api";

import { getLatestSmurfBoostDetection } from "./smurf-boost-api";

export function smurfBoostQueryKey(puuid: string) {
  return ["smurf-boost-detection", puuid] as const;
}

// `string`, not `string | null`: the one consumer takes a required `puuid`
// prop fed from `currentPlayer.puuid`. The null branch was a throw nothing
// could reach, kept alive by an `enabled` flag guarding against it.
export function smurfBoostQueryOptions(puuid: string) {
  return queryOptions({
    queryKey: smurfBoostQueryKey(puuid),
    queryFn: async () =>
      unwrapOr404(await getLatestSmurfBoostDetection(puuid), null),
    retry: false,
    staleTime: 30000,
    // SmurfBoostDetection renders this failure inline as a destructive alert.
    meta: { silenceErrorToast: true },
  });
}
