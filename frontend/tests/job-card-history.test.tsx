// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { JobCardHistory } from "@/features/jobs/components/job-card-history";
import type { JobExecution } from "@/lib/core/schemas";

function execution(overrides: Partial<JobExecution> = {}): JobExecution {
  return {
    id: 100,
    job_config_id: 7,
    started_at: "2026-08-19T10:00:00Z",
    completed_at: null,
    status: "SUCCESS",
    api_requests_made: 0,
    records_created: 0,
    records_updated: 0,
    error_message: null,
    execution_log: null,
    detailed_logs: null,
    triggered_by: "user",
    has_api_key_error: false,
    execution_type: "REGULAR",
    ...overrides,
  };
}

/** Minutes ago, as an ISO stamp `formatLastRun` can ladder without edge luck. */
function minutesAgo(minutes: number) {
  return new Date(Date.now() - minutes * 60_000 - 5_000).toISOString();
}

/** The row buttons: one per execution, in the order the list gave them. */
function historyRows() {
  return screen
    .queryAllByRole("button")
    .filter((button) => button.textContent?.includes("API:"));
}

function renderHistory({
  recentExecutions,
  isAnyForceStopping = false,
  onExecutionClick,
}: {
  recentExecutions: JobExecution[];
  isAnyForceStopping?: boolean;
  onExecutionClick?: (executionId: number) => void;
}) {
  return render(
    <JobCardHistory
      recentExecutions={recentExecutions}
      isAnyForceStopping={isAnyForceStopping}
      onExecutionClick={onExecutionClick}
    />,
  );
}

describe("JobCardHistory", () => {
  it("says so plainly when the job has never run", () => {
    renderHistory({ recentExecutions: [] });

    expect(screen.getByText("Recent Executions")).not.toBeNull();
    expect(screen.getByText("No executions yet")).not.toBeNull();
    expect(historyRows()).toHaveLength(0);
  });

  it("draws one row per execution, newest first, with what an admin needs at a glance", () => {
    renderHistory({
      recentExecutions: [
        execution({
          id: 102,
          status: "RATE_LIMITED",
          api_requests_made: 34,
          started_at: minutesAgo(5),
          completed_at: minutesAgo(5 - 0.5),
        }),
        execution({
          id: 101,
          status: "RUNNING",
          api_requests_made: 12,
          started_at: minutesAgo(125),
        }),
      ],
    });

    const rows = historyRows();
    expect(rows).toHaveLength(2);

    const newest = within(rows[0] as HTMLElement);
    // The badge opens the underscore; the row pairs it with the Riot call
    // count and the age, which is what "rate limited again?" gets decided on.
    expect(newest.getByText("RATE LIMITED")).not.toBeNull();
    expect(newest.getByText("API: 34")).not.toBeNull();
    expect(newest.getByText("5m ago")).not.toBeNull();
    expect(newest.getByText("30.0s")).not.toBeNull();

    // A run still in flight has no duration to show, and the copy says that
    // instead of a blank or a fake zero.
    const older = within(rows[1] as HTMLElement);
    expect(older.getByText("RUNNING")).not.toBeNull();
    expect(older.getByText("API: 12")).not.toBeNull();
    expect(older.getByText("2h ago")).not.toBeNull();
    expect(older.getByText("N/A")).not.toBeNull();
  });

  it("hands the row's execution id to the click handler", async () => {
    const onExecutionClick = vi.fn<(executionId: number) => void>();
    const user = userEvent.setup();
    renderHistory({
      recentExecutions: [execution({ id: 77 })],
      onExecutionClick,
    });

    const [row] = historyRows();
    expect(row).not.toBeUndefined();
    await user.click(row as HTMLElement);

    // The id, not the row index: the parent opens the execution's own log.
    expect(onExecutionClick).toHaveBeenCalledWith(77);
  });

  it("still renders when no click handler is offered", () => {
    // `onExecutionClick` is optional and the card only passes it on the jobs
    // page; a row that assumed it would crash everywhere else.
    renderHistory({ recentExecutions: [execution({ id: 1 })] });

    expect(historyRows()).toHaveLength(1);
  });

  it("flags a running row as force stopping, and only a running one", () => {
    // The amber flag is the admin's only warning that the button they are
    // about to press kills the run mid-write; showing it on finished rows,
    // or hiding it while a stop is in flight, both misdirect that press.
    const { rerender } = render(
      <JobCardHistory
        recentExecutions={[
          execution({ id: 1, status: "RUNNING" }),
          execution({ id: 2, status: "SUCCESS", completed_at: minutesAgo(10) }),
        ]}
        isAnyForceStopping={false}
      />,
    );
    expect(screen.queryByText("force stopping")).toBeNull();

    rerender(
      <JobCardHistory
        recentExecutions={[
          execution({ id: 1, status: "RUNNING" }),
          execution({ id: 2, status: "SUCCESS", completed_at: minutesAgo(10) }),
        ]}
        isAnyForceStopping
      />,
    );

    const rows = historyRows();
    expect(within(rows[0] as HTMLElement).getByText("force stopping"))
      .not.toBeNull();
    expect(within(rows[1] as HTMLElement).queryByText("force stopping"))
      .toBeNull();
  });
});
