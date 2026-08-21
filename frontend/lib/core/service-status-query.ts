import { queryOptions } from "@tanstack/react-query";

import { unwrap, validatedGet } from "@/lib/core/api";
import { ServiceStatusSchema } from "@/lib/core/schemas";

/**
 * The one credential-health read.
 *
 * The header banner and the settings card both need to know whether the Riot
 * key is usable. They used to ask two endpoints backed by the same
 * `synchronize_riot_credential_health` call, and only the banner's had a
 * refetch interval -- so when the development key aged out overnight the
 * banner flipped within fifteen seconds while the card below it went on
 * saying the key was fine until the page was reloaded.
 *
 * Sharing the options object also keeps the two observers from disagreeing
 * about staleness on one key.
 */
export function serviceStatusQueryOptions(options?: { enabled?: boolean }) {
  return queryOptions({
    queryKey: ["service-status"],
    queryFn: async () =>
      unwrap(
        await validatedGet(ServiceStatusSchema, "/settings/service-status"),
      ),
    enabled: options?.enabled ?? true,
    staleTime: 5 * 1000,
    refetchInterval: 15 * 1000,
    refetchOnWindowFocus: true,
  });
}
