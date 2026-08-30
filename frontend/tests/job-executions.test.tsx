// @vitest-environment jsdom

import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiRoute } from "./support/api-route";
import { server } from "./support/msw-server";

import { JobExecutions } from "@/features/jobs/components/job-executions";
import type {
  JobConfiguration,
  JobExecution,
  JobExecutionListResponse,
} from "@/lib/core/schemas";
import { renderWithQueryClient } from "./support/render-support";

// The component observes a sentinel div to page in more rows. jsdom never
// intersects anything, so a no-op keeps the constructor from throwing without
// pretending to exercise that path.
class NoopIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

function execution(overrides: Partial<JobExecution> = {}): JobExecution {
  return {
    id: 1,
    job_config_id: 7,
    started_at: "2026-01-02T03:04:05.000Z",
    completed_at: "2026-01-02T03:04:35.000Z",
    status: "SUCCESS",
    api_requests_made: 3,
    records_created: 2,
    records_updated: 1,
    triggered_by: "system",
    has_api_key_error: false,
    execution_type: "REGULAR",
    ...overrides,
  };
}

function listOf(
  executions: JobExecution[],
  total = executions.length,
): JobExecutionListResponse {
  return { executions, total, page: 1, size: 20, pages: 1 };
}

const MATCH_FETCHER: JobConfiguration = {
  id: 7,
  job_type: "MATCH_FETCHER",
  name: "Match Fetcher",
  schedule: "900",
  interval_seconds: 900,
  is_active: true,
  is_paused: false,
  is_running: false,
  is_stopping: false,
  is_force_stopping: false,
  is_test_running: false,
  is_test_paused: false,
  is_test_stopping: false,
  is_test_force_stopping: false,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

/**
 * Answer the table's own request with one page, or refuse it. The component
 * owns that query, so the fixture goes on the wire rather than in as a prop --
 * taking both means two requests for the identical first page.
 */
function serveExecutions(executions: JobExecutionListResponse | null) {
  server.use(
    http.get(apiRoute("/jobs/executions/all"), () =>
      executions === null
        ? new HttpResponse(null, { status: 500 })
        : HttpResponse.json(executions),
    ),
  );
}

function renderExecutions(props: {
  executions: JobExecutionListResponse | null;
  jobs?: JobConfiguration[];
  selectedExecutionId?: number | null;
}) {
  serveExecutions(props.executions);
  const tree = (selectedExecutionId: number | null) => (
    <JobExecutions
      jobs={props.jobs ?? [MATCH_FETCHER]}
      selectedExecutionId={selectedExecutionId}
    />
  );
  const { queryClient, rerender } = renderWithQueryClient(
    tree(props.selectedExecutionId ?? null),
  );
  return {
    queryClient,
    setSelectedExecutionId: (id: number | null) => rerender(tree(id)),
  };
}

describe("the executions table on the jobs page", () => {
  beforeEach(() => {
    // Re-stubbed each time: `unstubGlobals` tears every stub down after a
    // test, so a single module-scope stub leaves test two onwards without an
    // `IntersectionObserver` at all.
    vi.stubGlobal("IntersectionObserver", NoopIntersectionObserver);
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps the rows on screen when the 15-second poll fails", async () => {
    // This query re-runs every 15 seconds behind a table someone is reading,
    // and the queryFn re-throws rather than returning a failure envelope, so
    // React Query keeps the pages it already has.
    const { queryClient } = renderExecutions({
      executions: listOf([execution({ id: 41 })]),
    });

    expect(await screen.findByText("Match Fetcher")).toBeTruthy();

    serveExecutions(null);
    await queryClient.refetchQueries({ queryKey: ["job-executions-infinite"] });

    expect(screen.getByText("Match Fetcher")).toBeTruthy();
    expect(screen.queryByText("No job executions found")).toBeNull();

    queryClient.clear();
  });

  it("says the history could not be loaded rather than that nothing ran", async () => {
    // The distinction the page could not make while a failed seed query left
    // the infinite query disabled: an API that is down is not a scheduler
    // that has never run.
    const { queryClient } = renderExecutions({ executions: null });

    expect(
      await screen.findByText(/Execution history could not be loaded/),
    ).toBeTruthy();
    expect(screen.queryByText("No job executions found")).toBeNull();

    queryClient.clear();
  });

  it("names a job the page did not hand it by id rather than undefined", async () => {
    // Executions and job configurations arrive from two different requests. A
    // job removed, renamed, or simply not in this page's list still has rows
    // here, and the fallback is what keeps the first column readable.
    const { queryClient } = renderExecutions({
      executions: listOf([execution({ id: 42, job_config_id: 99 })]),
      jobs: [MATCH_FETCHER],
    });

    expect(await screen.findByText("Job #99")).toBeTruthy();

    queryClient.clear();
  });

  it("opens the dialog for a deep link and stays shut for one that no longer resolves", async () => {
    // `selectedExecutionId` comes from the URL, so it can name an execution
    // that is not in the loaded page. That has to resolve to a closed dialog
    // rather than throwing on a missing row.
    const { queryClient } = renderExecutions({
      executions: listOf([execution({ id: 42, job_config_id: 7 })]),
      selectedExecutionId: 42,
    });

    expect(await screen.findByRole("dialog")).toBeTruthy();
    cleanup();
    queryClient.clear();

    const { queryClient: second } = renderExecutions({
      executions: listOf([execution({ id: 42, job_config_id: 7 })]),
      selectedExecutionId: 999,
    });

    await screen.findByText("Match Fetcher");
    expect(screen.queryByRole("dialog")).toBeNull();

    second.clear();
  });

  it("lets a later deep link close a dialog the click opened", async () => {
    const user = userEvent.setup();
    // Clicking a row remembers it internally *and* reports it upwards, which is
    // what puts the id in the URL. So once a `selectedExecutionId` arrives it is
    // the answer, including when it resolves to nothing.
    const { queryClient, setSelectedExecutionId } = renderExecutions({
      executions: listOf([execution({ id: 42, job_config_id: 7 })]),
      selectedExecutionId: null,
    });

    await user.click(await screen.findByText("Match Fetcher"));
    expect(await screen.findByRole("dialog")).toBeTruthy();

    setSelectedExecutionId(999);

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    queryClient.clear();
  });

  it("distinguishes a partly loaded list from a fully loaded one", async () => {
    const { queryClient } = renderExecutions({
      executions: listOf([execution({ id: 42 })], 57),
    });

    expect(await screen.findByText(/Showing 1 of 57 executions/)).toBeTruthy();

    cleanup();
    queryClient.clear();

    const { queryClient: second } = renderExecutions({
      executions: listOf([execution({ id: 42 })], 1),
    });

    expect(await screen.findByText(/All 1 executions loaded/)).toBeTruthy();

    second.clear();
  });

  it("says nothing has run rather than showing an empty table", async () => {
    const { queryClient } = renderExecutions({ executions: listOf([]) });

    expect(await screen.findByText("No job executions found")).toBeTruthy();

    queryClient.clear();
  });
});
