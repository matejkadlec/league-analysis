import { queryOptions, skipToken } from "@tanstack/react-query";
import { unwrapOr404 } from "@/lib/core/api";

import { getLatestSmurfBoostDetection } from "./smurf-boost-api";

export function smurfBoostQueryKey(puuid: string | null) {
  return ["smurf-boost-detection", puuid] as const;
}

// Nullable again, because the card outlives its player: the page renders it
// with no analysed player so the local search inside it stays reachable, and
// an account with none yet -- or a `?puuid=` that will not load -- has nothing
// to read. `skipToken` rather than `enabled`, as `playerQueryOptions` does:
// `enabled` is an ordinary option a spreading caller can drop, and
// `SmurfBoostDetection` spreads these options to add its poll interval.
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
