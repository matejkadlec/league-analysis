import { queryOptions } from "@tanstack/react-query";

import { unwrap, validatedGet } from "@/lib/core/api";
import { ServiceStatusSchema } from "@/lib/core/schemas";

/** The cache both observers share; every write to the key spells it from here. */
export const SERVICE_STATUS_QUERY_KEY = ["service-status"] as const;

/**
 * The one credential-health read. Splitting it again gives the header banner
 * and the settings card separate refetch schedules, so they disagree whenever
 * the key's health changes.
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
