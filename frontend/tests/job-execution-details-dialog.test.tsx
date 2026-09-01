// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { JobExecutionDetailsDialog } from "@/features/jobs/components/job-execution-details-dialog";
import type {
  JobExecution,
  JobExecutionApiCall,
} from "@/lib/core/schemas";

// Built in local time so the rendered timestamps hold in every zone the
// gate runs under; the seconds are the jobs surfaces' own policy.
const STARTED = new Date(2026, 0, 2, 14, 4, 5).toISOString();
const COMPLETED = new Date(2026, 0, 2, 14, 4, 35).toISOString();

function execution(overrides: Partial<JobExecution> = {}): JobExecution {
  return {
    id: 1,
    job_config_id: 7,
    started_at: STARTED,
    completed_at: COMPLETED,
    status: "SUCCESS",
    api_requests_made: 3,
    records_created: 2,
    records_updated: 1,
    triggered_by: "user",
    has_api_key_error: false,
    execution_type: "REGULAR",
    ...overrides,
  };
}

const API_CALL: JobExecutionApiCall = {
  endpoint: "/lol/match/v5/matches",
  region: "europe",
  count: 1,
  first_timestamp: null,
  last_timestamp: null,
  params: { queue: "420" },
  param_key: "queue",
  first_param: "420",
  last_param: null,
};

describe("the job execution details dialog", () => {
  it("renders no dialog while nothing is selected", () => {
    const onOpenChange = vi.fn<(open: boolean) => void>();
    render(
      <JobExecutionDetailsDialog execution={null} onOpenChange={onOpenChange} />,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("summarises the finished run a row click opened", () => {
    render(
      <JobExecutionDetailsDialog
        execution={execution()}
        onOpenChange={vi.fn<(open: boolean) => void>()}
      />,
    );

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Execution Details")).toBeTruthy();
    expect(screen.getByText("SUCCESS")).toBeTruthy();
    expect(screen.getByText("User")).toBeTruthy();
    expect(screen.getByText("Riot API requests:")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("Records created:")).toBeTruthy();
    expect(screen.getByText("Records updated:")).toBeTruthy();
    expect(screen.getByText("2.1.2026 2:04:05 PM")).toBeTruthy();
    expect(screen.getByText("2.1.2026 2:04:35 PM")).toBeTruthy();
    expect(screen.getByText("30.0s")).toBeTruthy();
    // A successful run has no error block to show.
    expect(screen.queryByText("Error Message")).toBeNull();
  });

  it("says N/A about the moments a failed run never reached, and shows why", () => {
    render(
      <JobExecutionDetailsDialog
        execution={execution({
          status: "FAILED",
          completed_at: null,
          error_message: "Riot returned 503 for every retry.",
        })}
        onOpenChange={vi.fn<(open: boolean) => void>()}
      />,
    );

    expect(screen.getByText("FAILED")).toBeTruthy();
    // Both unknowns read N/A: no completion timestamp, no duration.
    expect(screen.getAllByText("N/A")).toHaveLength(2);
    expect(screen.getByText("Error Message")).toBeTruthy();
    expect(screen.getByText("Riot returned 503 for every retry.")).toBeTruthy();
  });

  it("hands a close back to the caller that owns the selection", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn<(open: boolean) => void>();
    render(
      <JobExecutionDetailsDialog
        execution={execution()}
        onOpenChange={onOpenChange}
      />,
    );

    // The dialog the caller opened is on screen before its close is asked
    // for; the callback is how the owner learns to clear the selection.
    expect(screen.getByRole("dialog")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows the API call transcript, never the raw log lines, when detailed logs exist", () => {
    // Both lists are present whenever `detailed_logs` exists, so the dialog's
    // own choice is the grouped transcript over the raw lines that also came.
    render(
      <JobExecutionDetailsDialog
        execution={execution({
          detailed_logs: {
            logs: [{ level: "info", event: "raw line" }],
            api_calls: [API_CALL],
          },
        })}
        onOpenChange={vi.fn<(open: boolean) => void>()}
      />,
    );

    expect(screen.getByText(/Called \/lol\/match\/v5\/matches once/)).toBeTruthy();
    expect(screen.queryByText("[INFO]")).toBeNull();

    cleanup();

    // No detailed logs at all: neither transcript nor raw lines, only the
    // statistics grid every execution has.
    render(
      <JobExecutionDetailsDialog
        execution={execution()}
        onOpenChange={vi.fn<(open: boolean) => void>()}
      />,
    );

    expect(screen.queryByText(/Called \/lol/)).toBeNull();
    expect(screen.queryByText("[INFO]")).toBeNull();
    expect(screen.getByText("Records created:")).toBeTruthy();
  });
});
