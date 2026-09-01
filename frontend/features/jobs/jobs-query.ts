import {
  infiniteQueryOptions,
  queryOptions,
  type QueryClient,
} from "@tanstack/react-query";
import { z } from "zod";

import { unwrap, validatedGet } from "@/lib/core/http/api";
import {
  JobConfigurationSchema,
  JobExecutionListResponseSchema,
  JobStatusResponseSchema,
} from "@/lib/core/schemas";

import { JOBS_REFRESH_INTERVAL_MS } from "./refresh-interval";

/**
 * The four caches the jobs surface reads, named once.
 */
function jobsQueryKey() {
  return ["jobs"] as const;
}

function jobStatusQueryKey() {
  return ["job-status"] as const;
}

// The bare prefix is real API: `invalidateJobsData` invalidates it so one
// call refreshes every card's per-job history at once.
const JOB_EXECUTIONS_QUERY_KEY = ["job-executions"] as const;

function jobExecutionsQueryKey(jobId: number) {
  return [...JOB_EXECUTIONS_QUERY_KEY, jobId] as const;
}

function jobExecutionsInfiniteQueryKey() {
  return ["job-executions-infinite"] as const;
}

/** Bounded against the router by tests/api-contract-alignment.test.ts. */
export const EXECUTIONS_PAGE_SIZE = 20;

/**
 * Fixed-size pages; the failure envelope is re-thrown, since returned as data
 * it truncates to page 1.
 */
export function jobExecutionsInfiniteQueryOptions() {
  return infiniteQueryOptions({
    queryKey: jobExecutionsInfiniteQueryKey(),
    queryFn: async ({ pageParam, signal }) => {
      return unwrap(
        await validatedGet(
          JobExecutionListResponseSchema,
          "/jobs/executions/all",
          { params: { page: pageParam, size: EXECUTIONS_PAGE_SIZE }, signal },
        ),
      );
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce(
        (sum, page) => sum + page.executions.length,
        0,
      );
      return loaded < lastPage.total ? allPages.length + 1 : undefined;
    },
    refetchInterval: JOBS_REFRESH_INTERVAL_MS,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });
}

/** Every job configuration, running or not, for the admin jobs page. */
export function jobsQueryOptions() {
  return queryOptions({
    queryKey: jobsQueryKey(),
    queryFn: async ({ signal }) =>
      unwrap(
        await validatedGet(
          z.array(JobConfigurationSchema),
          "/jobs/",
          { params: { active_only: false }, signal },
        ),
      ),
    refetchInterval: JOBS_REFRESH_INTERVAL_MS,
  });
}

/** The scheduler/system status strip above the job cards. */
export function jobStatusQueryOptions() {
  return queryOptions({
    queryKey: jobStatusQueryKey(),
    queryFn: async ({ signal }) =>
      unwrap(
        await validatedGet(
          JobStatusResponseSchema,
          "/jobs/status/overview",
          { signal },
        ),
      ),
    refetchInterval: JOBS_REFRESH_INTERVAL_MS,
  });
}

/** The five most recent scheduled runs, shown on one job's card. */
export function jobRecentExecutionsQueryOptions(jobId: number) {
  return queryOptions({
    queryKey: jobExecutionsQueryKey(jobId),
    queryFn: async ({ signal }) =>
      unwrap(
        await validatedGet(
          JobExecutionListResponseSchema,
          `/jobs/${jobId}/executions`,
          { params: { page: 1, size: 5, execution_type: "REGULAR" }, signal },
        ),
      ),
    enabled: !!jobId,
    refetchInterval: JOBS_REFRESH_INTERVAL_MS,
  });
}

/**
 * No trailing `refetchQueries`: `invalidateQueries` already refetches the
 * active ones, and every invalidation is awaited.
 */
export async function invalidateJobsData(
  queryClient: QueryClient,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: jobsQueryKey() }),
    queryClient.invalidateQueries({ queryKey: jobStatusQueryKey() }),
    queryClient.invalidateQueries({ queryKey: JOB_EXECUTIONS_QUERY_KEY }),
    queryClient.invalidateQueries({
      queryKey: jobExecutionsInfiniteQueryKey(),
    }),
  ]);
}
