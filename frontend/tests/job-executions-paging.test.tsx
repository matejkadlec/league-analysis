// @vitest-environment jsdom

import { act, screen, waitFor } from "@testing-library/react";

import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithQueryClient } from "./support/render-support";
import { apiRoute } from "./support/api-route";
import { server } from "./support/msw-server";

import type { JobExecution, JobExecutionListResponse } from "@/lib/core/schemas";

import { JobExecutions } from "@/features/jobs/components/job-executions";

// jsdom has no IntersectionObserver; this stand-in hands the callback to the
// test so it can put the sentinel "on screen" deliberately.
const observerCallbackRef: {
  current: IntersectionObserverCallback | null;
} = { current: null };

class FakeIntersectionObserver {
  constructor(callback: IntersectionObserverCallback) {
    observerCallbackRef.current = callback;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

/**
 * Throws rather than defaulting: a default would quietly answer page 1 for a
 * request that lost the param.
 */
function paging(query: URLSearchParams, name: "page" | "size"): number {
  const value = Number(query.get(name));
  if (!query.has(name) || !Number.isInteger(value)) {
    throw new Error(
      `expected an integer ${name} param, got ${String(query.get(name))}`,
    );
  }
  return value;
}

function execution(id: number): JobExecution {
  return {
    id,
    job_config_id: 1,
    started_at: "2026-08-19T10:00:00Z",
    completed_at: "2026-08-19T10:01:00Z",
    status: "SUCCESS",
    api_requests_made: 0,
    records_created: 0,
    records_updated: 0,
    triggered_by: "system",
    has_api_key_error: false,
    execution_type: "REGULAR",
  };
}

const TOTAL = 50;

function pageOf(page: number): JobExecutionListResponse {
  const start = (page - 1) * 20;
  const count = Math.min(20, TOTAL - start);
  return {
    executions: Array.from({ length: count }, (_, i) => execution(start + i + 1)),
    total: TOTAL,
    page,
    size: 20,
    pages: Math.ceil(TOTAL / 20),
  };
}

function scrollSentinelIntoView() {
  act(() => {
    observerCallbackRef.current?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      null as unknown as IntersectionObserver,
    );
  });
}

/** The `[page, size]` of every executions request that reached the API. */
const requested: [number, number][] = [];

/** Serve the page the request asks for -- or refuse every request, the way a
 * deploy does mid-poll. */
function servePages(failing = false) {
  server.use(
    http.get(apiRoute("/jobs/executions/all"), ({ request }) => {
      const query = new URL(request.url).searchParams;
      const page = paging(query, "page");
      requested.push([page, paging(query, "size")]);
      return failing
        ? new HttpResponse(null, { status: 500 })
        : HttpResponse.json(pageOf(page));
    }),
  );
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  observerCallbackRef.current = null;
  requested.length = 0;
  servePages();
});


function renderExecutions() {
  return renderWithQueryClient(
    <JobExecutions jobs={[]} selectedExecutionId={null} />,
  );
}

describe("the executions list's paging", () => {
  it("loads the next fixed-size page when the sentinel comes on screen", async () => {
    renderExecutions();
    await waitFor(() =>
      expect(screen.getByText("Showing 20 of 50 executions")).toBeTruthy(),
    );

    scrollSentinelIntoView();

    await waitFor(() =>
      expect(screen.getByText("Showing 40 of 50 executions")).toBeTruthy(),
    );
    expect(requested.at(-1)).toEqual([2, 20]);
  });

  it("never grows the page size past the backend's cap", async () => {
    // Paging must scale by page number, never by request size: the router
    // bounds `size` at `le=100` and 422s past it.
    renderExecutions();
    await waitFor(() =>
      expect(screen.getByText("Showing 20 of 50 executions")).toBeTruthy(),
    );

    scrollSentinelIntoView();
    await waitFor(() =>
      expect(screen.getByText("Showing 40 of 50 executions")).toBeTruthy(),
    );
    scrollSentinelIntoView();
    await waitFor(() =>
      expect(screen.getByText("All 50 executions loaded")).toBeTruthy(),
    );

    for (const [, size] of requested) {
      expect(size).toBeLessThanOrEqual(20);
    }
    expect(requested.map(([page]) => page)).toEqual([1, 2, 3]);
  });

  it("stops asking once everything is loaded", async () => {
    renderExecutions();
    await waitFor(() =>
      expect(screen.getByText("Showing 20 of 50 executions")).toBeTruthy(),
    );
    scrollSentinelIntoView();
    await waitFor(() =>
      expect(screen.getByText("Showing 40 of 50 executions")).toBeTruthy(),
    );
    scrollSentinelIntoView();
    await waitFor(() =>
      expect(screen.getByText("All 50 executions loaded")).toBeTruthy(),
    );
    const calls = requested.length;

    scrollSentinelIntoView();

    expect(requested).toHaveLength(calls);
  });

  it("keeps every loaded page on screen through a failed poll", async () => {
    // The poll refetches every loaded page, so a failure returned as data
    // rather than thrown replaces the good pages and truncates back to page 1.
    const { queryClient } = renderExecutions();
    await waitFor(() =>
      expect(screen.getByText("Showing 20 of 50 executions")).toBeTruthy(),
    );
    scrollSentinelIntoView();
    await waitFor(() =>
      expect(screen.getByText("Showing 40 of 50 executions")).toBeTruthy(),
    );

    servePages(true);
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ["job-executions-infinite"] });
    });
    expect(screen.getByText("Showing 40 of 50 executions")).toBeTruthy();

    // And the next successful poll still refetches both pages, not just one.
    servePages();
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ["job-executions-infinite"] });
    });
    expect(screen.getByText("Showing 40 of 50 executions")).toBeTruthy();
    expect(requested.slice(-2).map(([page]) => page)).toEqual([1, 2]);
  });
});
