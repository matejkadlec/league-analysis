import { QueryClient } from "@tanstack/react-query";
import { HttpResponse, http, type JsonBodyType } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { apiRoute } from "./support/api-route";
import { server } from "./support/msw-server";

import {
  invalidateJobsData,
  jobExecutionsInfiniteQueryOptions,
  jobRecentExecutionsQueryOptions,
  jobStatusQueryOptions,
  jobsQueryOptions,
} from "@/features/jobs/jobs-query";
import { JOBS_REFRESH_INTERVAL_MS } from "@/features/jobs/refresh-interval";
import type { JobExecutionListResponse } from "@/lib/core/schemas";

function executionList(count: number, total: number): JobExecutionListResponse {
  return {
    executions: Array.from({ length: count }, (_, index) => ({
      id: index + 1,
      job_config_id: 7,
      started_at: "2026-08-19T10:00:00Z",
      completed_at: null,
      status: "SUCCESS",
      api_requests_made: 0,
      records_created: 0,
      records_updated: 0,
      triggered_by: "system",
      has_api_key_error: false,
      execution_type: "REGULAR",
    })),
    total,
    page: 1,
    size: 20,
    pages: 1,
  };
}

/** The query string of every request the API actually received. */
const received: Record<string, string>[] = [];

/** Serve one route, and only that route: a request to any other path reaches
 * no handler, and `onUnhandledRequest: "error"` fails it. */
function serve(path: string, body: JsonBodyType) {
  server.use(
    http.get(apiRoute(path), ({ request }) => {
      received.push(Object.fromEntries(new URL(request.url).searchParams));
      return HttpResponse.json(body);
    }),
  );
}

function retryFreeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe("the jobs surface's four caches", () => {
  beforeEach(() => {
    received.length = 0;
  });

  it("lists every configuration, running or not, on the promised cadence", async () => {
    // The page header counts down JOBS_REFRESH_INTERVAL_MS; `active_only:
    // false` is what keeps retired jobs visible to the admin at all.
    serve("/jobs/", []);
    const options = jobsQueryOptions();
    const queryClient = retryFreeClient();

    // The cadence itself, not just agreement with the constant: every
    // `refetchInterval` below is built from this import, so identity alone
    // survives the interval dropping to two seconds.
    expect(JOBS_REFRESH_INTERVAL_MS).toBe(15_000);
    expect(options.refetchInterval).toBe(JOBS_REFRESH_INTERVAL_MS);
    await queryClient.fetchQuery(options);

    expect(received).toEqual([{ active_only: "false" }]);
    expect(queryClient.getQueryData(["jobs"])).toEqual([]);
  });

  it("reads the scheduler status strip from its own cache", async () => {
    const status = {
      scheduler_running: true,
      active_jobs: 2,
      running_executions: 1,
    };
    serve("/jobs/status/overview", status);
    const options = jobStatusQueryOptions();
    const queryClient = retryFreeClient();

    expect(options.refetchInterval).toBe(JOBS_REFRESH_INTERVAL_MS);
    await queryClient.fetchQuery(options);

    // Nothing narrows the strip: it reports the scheduler, not a selection.
    expect(received).toEqual([{}]);
    expect(queryClient.getQueryData(["job-status"])).toEqual(status);
  });

  it("asks for one job's five most recent scheduled runs, and only once it has an id", async () => {
    // A card with id 0 has nothing to request, and `execution_type:
    // REGULAR` keeps test runs out of the schedule's own history.
    serve("/jobs/7/executions", executionList(5, 5));
    const options = jobRecentExecutionsQueryOptions(7);
    const queryClient = retryFreeClient();

    expect(jobRecentExecutionsQueryOptions(0).enabled).toBe(false);
    expect(options.enabled).toBe(true);
    await queryClient.fetchQuery(options);

    expect(received).toEqual([
      { page: "1", size: "5", execution_type: "REGULAR" },
    ]);
    expect(queryClient.getQueryData(["job-executions", 7])).toEqual(
      executionList(5, 5),
    );
  });

  it("scrolls every job's executions in fixed-size pages and stops at the end", async () => {
    serve("/jobs/executions/all", executionList(20, 21));
    const options = jobExecutionsInfiniteQueryOptions();
    const queryClient = retryFreeClient();

    const result = await queryClient.fetchInfiniteQuery(options);

    expect(received).toEqual([{ page: "1", size: "20" }]);
    expect(result.pages).toHaveLength(1);
    expect(options.initialPageParam).toBe(1);
    // One more run exists than page 1 holds, so the next scroll asks for page
    // 2; an exactly-filled list stops instead of requesting an empty page.
    expect(
      options.getNextPageParam?.(
        executionList(20, 21),
        [executionList(20, 21)],
        1,
        [1],
      ),
    ).toBe(2);
    expect(
      options.getNextPageParam?.(
        executionList(20, 20),
        [executionList(20, 20)],
        1,
        [1],
      ),
    ).toBeUndefined();
    expect(
      options.getNextPageParam?.(
        executionList(1, 21),
        [executionList(20, 21), executionList(1, 21)],
        1,
        [1, 2],
      ),
    ).toBeUndefined();
    // The page keeps its own countdown; a refocus must not add extra polls
    // on top of the cadence the header promises.
    expect(options.refetchInterval).toBe(JOBS_REFRESH_INTERVAL_MS);
    expect(options.refetchOnWindowFocus).toBe(false);
  });

  it("re-throws the failure envelope rather than caching it as page 1", async () => {
    // Returned as data, a failure reads as "20 executions and done" and
    // silently truncates the list; thrown, it reaches the error state.
    server.use(
      http.get(
        apiRoute("/jobs/executions/all"),
        () => new HttpResponse(null, { status: 503 }),
      ),
    );
    const queryClient = retryFreeClient();

    await expect(
      queryClient.fetchInfiniteQuery(jobExecutionsInfiniteQueryOptions()),
    ).rejects.toThrow(
      "The League Analysis service could not complete the request.",
    );
    expect(
      queryClient.getQueryData(["job-executions-infinite"]),
    ).toBeUndefined();
  });
});

describe("invalidateJobsData", () => {
  it("marks all four caches, and every card's per-job history, in one call", async () => {
    const queryClient = new QueryClient();
    for (const key of [
      ["jobs"],
      ["job-status"],
      ["job-executions", 7],
      ["job-executions", 8],
      ["job-executions-infinite"],
      ["player-league", "not-a-job-cache"],
    ]) {
      queryClient.setQueryData(key, "seed");
    }

    await invalidateJobsData(queryClient);

    // The bare `job-executions` prefix is the point: one call refreshes
    // every card's history, not just one job's, and nothing else.
    for (const key of [
      ["jobs"],
      ["job-status"],
      ["job-executions", 7],
      ["job-executions", 8],
      ["job-executions-infinite"],
    ]) {
      expect(queryClient.getQueryState(key)?.isInvalidated, String(key)).toBe(
        true,
      );
    }
    expect(
      queryClient.getQueryState(["player-league", "not-a-job-cache"])
        ?.isInvalidated,
    ).toBe(false);
  });
});
