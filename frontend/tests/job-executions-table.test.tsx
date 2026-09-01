// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { JobExecutionsTable } from "@/features/jobs/components/job-executions-table";
import type { JobExecution } from "@/lib/core/schemas";

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

type SelectExecution = (execution: JobExecution) => void;

function renderTable(
  executions: JobExecution[],
  onSelectExecution: SelectExecution = vi.fn<SelectExecution>(),
) {
  return render(
    <JobExecutionsTable
      executions={executions}
      getJobName={(jobConfigId) =>
        jobConfigId === 7 ? "Match Fetcher" : `Job #${jobConfigId}`
      }
      onSelectExecution={onSelectExecution}
    />,
  );
}

describe("the job executions table", () => {
  it("tells a test run from a regular one, including what its numbers mean", () => {
    // A test execution must never read as though it wrote records: the row
    // replaces the records summary with a sentence saying it created none.
    renderTable([
      execution({
        id: 1,
        execution_type: "TEST",
        triggered_by: "user",
      }),
      execution({
        id: 2,
        execution_type: "REGULAR",
        triggered_by: "system",
        api_requests_made: 12,
      }),
    ]);

    // The test row: type badge, manual trigger, honest statistics line.
    expect(screen.getByText("Test")).toBeTruthy();
    expect(screen.getByText("User")).toBeTruthy();
    expect(screen.getByText("Riot API requests: 3")).toBeTruthy();
    expect(
      screen.getByText("Test run — no records created or updated"),
    ).toBeTruthy();

    // The regular row keeps the summary the formatters spell.
    expect(screen.getByText("Regular")).toBeTruthy();
    expect(screen.getByText("System")).toBeTruthy();
    expect(
      screen.getByText("2 records created and 1 records updated"),
    ).toBeTruthy();
  });

  it("hands the clicked row's whole execution to the details dialog owner", async () => {
    const user = userEvent.setup();
    const clicked = execution({ id: 41 });
    const onSelectExecution = vi.fn<SelectExecution>();
    renderTable([clicked], onSelectExecution);

    // The row on screen is this execution's row -- its own request count is
    // in it -- so the name being clicked names the run whose details open.
    const row = screen.getByText("Match Fetcher");
    expect(row.closest("tr")?.textContent).toContain("Riot API requests: 3");
    await user.click(row);

    expect(onSelectExecution).toHaveBeenCalledTimes(1);
    // The dialog reads this object, `detailed_logs` included; a reconstructed copy
    // would open with no transcript.
    expect(onSelectExecution).toHaveBeenCalledWith(clicked);
  });

  it("distinguishes a run that has not finished from one that has", () => {
    // Built in local time so the expectation holds in every zone the gate
    // runs under; the seconds are the jobs surfaces' own policy.
    const started = new Date(2026, 0, 2, 14, 4, 5).toISOString();
    const finished = new Date(2026, 0, 2, 14, 5, 35).toISOString();
    renderTable([
      execution({ id: 1, started_at: started, completed_at: null }),
      execution({ id: 2, started_at: started, completed_at: finished }),
    ]);

    // The open run: completion placeholder and no duration to report.
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.getByText("N/A")).toBeTruthy();
    // The finished run: both timestamps with seconds, and the 90s duration.
    expect(screen.getAllByText("2.1.2026 2:04:05 PM")).toHaveLength(2);
    expect(screen.getByText("2.1.2026 2:05:35 PM")).toBeTruthy();
    expect(screen.getByText("1m 30s")).toBeTruthy();
  });
});
