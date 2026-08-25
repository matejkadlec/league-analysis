import { queryOptions } from "@tanstack/react-query";

import { unwrap, validatedGet } from "@/lib/core/api";
import { ServiceStatusSchema } from "@/lib/core/schemas";

/** The cache both observers share; every write to the key spells it from here. */
export const SERVICE_STATUS_QUERY_KEY = ["service-status"] as const;

/**
 * The one credential-health read. The header banner and the settings card used
 * to ask two endpoints backed by the same call, only one of which refetched --
 * so when the development key aged out overnight the banner flipped within
 * fifteen seconds while the card below went on saying the key was fine.
 */
export function serviceStatusQueryOptions(options?: { enabled?: boolean }) {
  return queryOptions({
    queryKey: SERVICE_STATUS_QUERY_KEY,
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
