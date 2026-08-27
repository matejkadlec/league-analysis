import {
  infiniteQueryOptions,
  queryOptions,
  type QueryClient,
} from "@tanstack/react-query";
import { z } from "zod";

import { unwrap, validatedGet } from "@/lib/core/api";
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

const EXECUTIONS_PAGE_SIZE = 20;

/**
 * Every job's executions, newest first, infinitely scrolled. Fixed-size
 * pages, because the backend caps `size` at 100. The failure envelope is
 * re-thrown on purpose: returned as data it truncates the list to page 1.
 */
export function jobExecutionsInfiniteQueryOptions() {
  return infiniteQueryOptions({
    queryKey: jobExecutionsInfiniteQueryKey(),
    queryFn: async ({ pageParam, signal }) => {
      return unwrap(
        await validatedGet(
          JobExecutionListResponseSchema,
          "/jobs/executions/all",
          { page: pageParam, size: EXECUTIONS_PAGE_SIZE },
          signal,
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
          { active_only: false },
          signal,
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
          undefined,
          signal,
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
          { page: 1, size: 5, execution_type: "REGULAR" },
          signal,
        ),
      ),
    enabled: !!jobId,
    refetchInterval: JOBS_REFRESH_INTERVAL_MS,
  });
}

/**
 * Refresh everything a job control action changes. No trailing
 * `refetchQueries`: `invalidateQueries` already refetches active queries, and
 * the old inline copy's extra call only aborted that fetch and reissued it.
 */
export function invalidateJobsData(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: jobsQueryKey() });
  void queryClient.invalidateQueries({ queryKey: jobStatusQueryKey() });
  void queryClient.invalidateQueries({ queryKey: JOB_EXECUTIONS_QUERY_KEY });
  void queryClient.invalidateQueries({
    queryKey: jobExecutionsInfiniteQueryKey(),
  });
}
