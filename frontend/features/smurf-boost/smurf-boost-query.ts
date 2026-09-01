import { queryOptions, skipToken } from "@tanstack/react-query";
import { unwrapOr404 } from "@/lib/core/http/api";

import { getLatestSmurfBoostDetection } from "./smurf-boost-api";

export function smurfBoostQueryKey(puuid: string | null) {
  return ["smurf-boost-detection", puuid] as const;
}

// Nullable: the page renders this card with no analysed player so the local
// search stays reachable. `skipToken`, not `enabled` -- a spreading caller can drop that.
export function smurfBoostQueryOptions(puuid: string | null) {
  return queryOptions({
    queryKey: smurfBoostQueryKey(puuid),
    queryFn: puuid
      ? async ({ signal }) =>
          unwrapOr404(await getLatestSmurfBoostDetection(puuid, signal), null)
      : skipToken,
    retry: false,
    staleTime: 30000,
    // SmurfBoostDetection renders this failure inline as a destructive alert.
    meta: { silenceErrorToast: true },
  });
}
