// @vitest-environment jsdom

import { act, screen, waitFor } from "@testing-library/react";

import { renderWithQueryClient } from "./render-support";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { JobExecution, JobExecutionListResponse } from "@/lib/core/schemas";

const { validatedGet } = vi.hoisted(() => ({ validatedGet: vi.fn() }));

vi.mock("@/lib/core/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/api")>()),
  validatedGet,
}));

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

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  observerCallbackRef.current = null;
  validatedGet.mockReset();
  validatedGet.mockImplementation(async (_schema, _url, params) => ({
    success: true,
    data: pageOf((params as { page: number }).page),
  }));
});


function renderExecutions() {
  return renderWithQueryClient(
    <JobExecutions
      executions={pageOf(1)}
      jobs={[]}
      selectedExecutionId={null}
    />,
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
    expect(validatedGet).toHaveBeenLastCalledWith(
      expect.anything(),
      "/jobs/executions/all",
      { page: 2, size: 20 },
    );
  });

  it("never grows the page size past the backend's cap", async () => {
    // The regression this component shipped with: a single growing-`size`
    // request hit the router's `le=100` bound and 422'd on the sixth
    // load-more. Paging must scale by page number, never by request size.
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

    for (const call of validatedGet.mock.calls) {
      expect((call[2] as { size: number }).size).toBeLessThanOrEqual(20);
    }
    expect(validatedGet.mock.calls.map((call) => (call[2] as { page: number }).page)).toEqual(
      [1, 2, 3],
    );
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
    const calls = validatedGet.mock.calls.length;

    scrollSentinelIntoView();

    expect(validatedGet.mock.calls.length).toBe(calls);
  });

  it("keeps every loaded page on screen through a failed poll", async () => {
    // The 15-second poll refetches all loaded pages. If the failure envelope
    // were returned as data instead of thrown, React Query would *replace*
    // the good pages with it, truncate the list back to page 1, and stop
    // paging — an operator scrolled to 40 rows loses 20 of them to a deploy
    // blip and they do not come back on the next successful tick.
    const { queryClient } = renderExecutions();
    await waitFor(() =>
      expect(screen.getByText("Showing 20 of 50 executions")).toBeTruthy(),
    );
    scrollSentinelIntoView();
    await waitFor(() =>
      expect(screen.getByText("Showing 40 of 50 executions")).toBeTruthy(),
    );

    validatedGet.mockResolvedValue({
      success: false,
      error: { kind: "server", status: 500, message: "deploying" },
    });
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ["job-executions-infinite"] });
    });
    expect(screen.getByText("Showing 40 of 50 executions")).toBeTruthy();

    // And the next successful poll still refetches both pages, not just one.
    validatedGet.mockImplementation(async (_schema, _url, params) => ({
      success: true,
      data: pageOf((params as { page: number }).page),
    }));
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ["job-executions-infinite"] });
    });
    expect(screen.getByText("Showing 40 of 50 executions")).toBeTruthy();
    const refetchedPages = validatedGet.mock.calls
      .slice(-2)
      .map((call) => (call[2] as { page: number }).page);
    expect(refetchedPages).toEqual([1, 2]);
  });
});
