import { queryOptions, skipToken } from "@tanstack/react-query";
import { unwrapOr404 } from "@/lib/core/api";

import { getLatestSmurfBoostDetection } from "./smurf-boost-api";

export function smurfBoostQueryKey(puuid: string | null) {
  return ["smurf-boost-detection", puuid] as const;
}

// Nullable, because the card outlives its player: the page renders it with no
// analysed player so the local search stays reachable. `skipToken` rather than
// `enabled`, an ordinary option a spreading caller can drop.
export function smurfBoostQueryOptions(puuid: string | null) {
  return queryOptions({
    queryKey: smurfBoostQueryKey(puuid),
    queryFn: puuid
      ? async () => unwrapOr404(await getLatestSmurfBoostDetection(puuid), null)
      : skipToken,
    retry: false,
    staleTime: 30000,
    // SmurfBoostDetection renders this failure inline as a destructive alert.
    meta: { silenceErrorToast: true },
  });
}
