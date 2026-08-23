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
 *
 * They used to be inline literals across four files, with the invalidation
 * set copied by hand into the control hook — the same drift the matchmaking
 * feature already paid for once (see `matchmaking-query.ts`).
 *
 * The executions key is a prefix: each job card extends it with its job id,
 * and `invalidateJobsData` invalidates the bare prefix so every card's
 * history refreshes at once.
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
 * Every job's executions, newest first, as an infinitely-scrolled list.
 *
 * Fixed-size pages, not one growing request: the backend caps `size` at
 * 100, so the old growing-`size` query 422'd on the sixth load-more.
 * Tradeoff accepted with the switch: `refetchInterval` refreshes every
 * loaded page each tick (N small requests instead of one big one).
 *
 * The failure envelope is deliberately re-thrown: returned as data, a
 * single failed 15-second poll would *replace* every loaded page and
 * truncate the list to page 1 until someone scrolls it back in. Thrown,
 * React Query keeps the previous pages (and their pageParams) stale and
 * retries on the next tick. It throws through `unwrap` rather than a bare
 * `Error` so the toast keeps the curated message -- see `ApiRequestError`.
 */
export function jobExecutionsInfiniteQueryOptions() {
  return infiniteQueryOptions({
    queryKey: jobExecutionsInfiniteQueryKey(),
    queryFn: async ({ pageParam }) => {
      return unwrap(
        await validatedGet(
          JobExecutionListResponseSchema,
          "/jobs/executions/all",
          { page: pageParam, size: EXECUTIONS_PAGE_SIZE },
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
    queryFn: async () =>
      unwrap(
        await validatedGet(z.array(JobConfigurationSchema), "/jobs/", {
          active_only: false,
        }),
      ),
    refetchInterval: JOBS_REFRESH_INTERVAL_MS,
  });
}

/** The scheduler/system status strip above the job cards. */
export function jobStatusQueryOptions() {
  return queryOptions({
    queryKey: jobStatusQueryKey(),
    queryFn: async () =>
      unwrap(
        await validatedGet(JobStatusResponseSchema, "/jobs/status/overview"),
      ),
    refetchInterval: JOBS_REFRESH_INTERVAL_MS,
  });
}

/** The five most recent scheduled runs, shown on one job's card. */
export function jobRecentExecutionsQueryOptions(jobId: number) {
  return queryOptions({
    queryKey: jobExecutionsQueryKey(jobId),
    queryFn: async () =>
      unwrap(
        await validatedGet(
          JobExecutionListResponseSchema,
          `/jobs/${jobId}/executions`,
          { page: 1, size: 5, execution_type: "REGULAR" },
        ),
      ),
    enabled: !!jobId,
    refetchInterval: JOBS_REFRESH_INTERVAL_MS,
  });
}

/**
 * Refresh everything a job control action changes.
 *
 * No trailing `refetchQueries` on the jobs key: `invalidateQueries` already
 * refetches active queries, and the old inline copy's extra call only
 * aborted that fetch and reissued it.
 */
export function invalidateJobsData(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: jobsQueryKey() });
  void queryClient.invalidateQueries({ queryKey: jobStatusQueryKey() });
  void queryClient.invalidateQueries({ queryKey: JOB_EXECUTIONS_QUERY_KEY });
  void queryClient.invalidateQueries({
    queryKey: jobExecutionsInfiniteQueryKey(),
  });
}
