// @vitest-environment jsdom

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { validatedGet } = vi.hoisted(() => ({ validatedGet: vi.fn() }));

vi.mock("@/lib/core/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/api")>()),
  validatedGet,
}));

import { JobExecutions } from "@/features/jobs/components/job-executions";
import type {
  JobConfiguration,
  JobExecution,
  JobExecutionListResponse,
} from "@/lib/core/schemas";
import { renderWithQueryClient } from "./render-support";

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
vi.stubGlobal("IntersectionObserver", NoopIntersectionObserver);

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

function renderExecutions(props: {
  executions: JobExecutionListResponse | null;
  jobs?: JobConfiguration[];
  selectedExecutionId?: number | null;
}) {
  const tree = (selectedExecutionId: number | null) => (
    <JobExecutions
      executions={props.executions}
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
    validatedGet.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps the rows on screen when the 15-second poll fails", async () => {
    // This query re-runs every 15 seconds behind a table someone is reading.
    // The refusal path falls back to the executions handed in by the page, so
    // a single failed poll must not empty the table -- otherwise a working
    // scheduler momentarily looks like one that has never run.
    validatedGet.mockResolvedValue({
      success: false,
      error: { kind: "server", status: 500, message: "boom" },
    });

    const { queryClient } = renderExecutions({
      executions: listOf([execution({ id: 41 })]),
    });

    await waitFor(() => expect(validatedGet).toHaveBeenCalled());

    expect(screen.getByText("Match Fetcher")).toBeTruthy();
    expect(screen.queryByText("No job executions found")).toBeNull();

    queryClient.clear();
  });

  it("names a job the page did not hand it by id rather than undefined", async () => {
    // Executions and job configurations arrive from two different requests. A
    // job removed, renamed, or simply not in this page's list still has rows
    // here, and the fallback is what keeps the first column readable.
    validatedGet.mockResolvedValue({ success: false, error: {} });

    const { queryClient } = renderExecutions({
      executions: listOf([execution({ id: 42, job_config_id: 99 })]),
      jobs: [MATCH_FETCHER],
    });

    expect(await screen.findByText("Job #99")).toBeTruthy();

    queryClient.clear();
  });

  it("opens the dialog for a deep link and stays shut for one that no longer resolves", async () => {
    // `selectedExecutionId` comes from the URL, so it can name an execution
    // that is not in the loaded page -- an old link, or a row past the end of
    // what has been paged in. That has to resolve to a closed dialog rather
    // than throwing on a missing row.
    validatedGet.mockResolvedValue({ success: false, error: {} });

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
    // Clicking a row remembers it internally *and* reports it upwards, which
    // is what puts the id in the URL. So once a `selectedExecutionId` arrives,
    // it is the answer -- including when it resolves to nothing. Falling back
    // to the remembered row instead would leave the previous execution's
    // details on screen under a URL naming a different one.
    validatedGet.mockResolvedValue({ success: false, error: {} });

    const { queryClient, setSelectedExecutionId } = renderExecutions({
      executions: listOf([execution({ id: 42, job_config_id: 7 })]),
      selectedExecutionId: null,
    });

    fireEvent.click(await screen.findByText("Match Fetcher"));
    expect(await screen.findByRole("dialog")).toBeTruthy();

    setSelectedExecutionId(999);

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    queryClient.clear();
  });

  it("distinguishes a partly loaded list from a fully loaded one", async () => {
    validatedGet.mockResolvedValue({ success: false, error: {} });

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
    validatedGet.mockResolvedValue({ success: false, error: {} });

    const { queryClient } = renderExecutions({ executions: listOf([]) });

    expect(await screen.findByText("No job executions found")).toBeTruthy();

    queryClient.clear();
  });
});
