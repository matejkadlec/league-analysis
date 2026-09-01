// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SystemStatus } from "@/features/jobs/components/system-status";
import type { JobStatusResponse } from "@/lib/core/schemas";

const NOW = new Date("2026-08-19T12:00:00Z");

function execution(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    job_id: 1,
    job_name: "Match Fetcher",
    status: "SUCCESS",
    started_at: NOW.toISOString(),
    completed_at: null,
    duration_seconds: null,
    records_processed: null,
    error_message: null,
    triggered_by: "SCHEDULER",
    ...overrides,
  } as unknown as NonNullable<JobStatusResponse["last_execution"]>;
}

function status(overrides: Partial<JobStatusResponse> = {}): JobStatusResponse {
  return {
    scheduler_running: true,
    active_jobs: 3,
    running_executions: 0,
    last_execution: execution(),
    ...overrides,
  };
}

/** The one line an admin reads before deciding whether to look further. */
function headline(): string {
  return screen.getByText(
    /All Systems Operational|Jobs in Progress|Scheduler Offline|Check Required/,
  ).textContent as string;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("the jobs system status", () => {
  it("says nothing is known rather than drawing empty cards", () => {
    // `null` means the request failed or has not answered, so cards reading
    // "Stopped", "0", "0" and "None" would be a specific and wrong claim.
    render(<SystemStatus status={null} />);

    expect(screen.getByText("No status information available")).toBeTruthy();
    expect(screen.queryByText("Scheduler")).toBeNull();
  });

  it("reads healthy only when the scheduler is up and nothing is mid-run", () => {
    render(<SystemStatus status={status()} />);
    expect(headline()).toBe("All Systems Operational");
  });

  it("does not call a stopped scheduler healthy", () => {
    // This is the state the whole page exists to surface: no job will run
    // again until someone acts. It has to be the headline, not a badge.
    render(<SystemStatus status={status({ scheduler_running: false })} />);

    expect(headline()).toBe("Scheduler Offline");
    expect(screen.getByText("Stopped")).toBeTruthy();
    expect(screen.getByText("Offline")).toBeTruthy();
  });

  it("distinguishes work in progress from an idle system", () => {
    // Both are fine states; telling them apart stops an admin from restarting
    // a job that is still running.
    render(<SystemStatus status={status({ running_executions: 2 })} />);

    expect(headline()).toBe("Jobs in Progress");
    expect(screen.getByText("In Progress")).toBeTruthy();
    expect(screen.queryByText("Idle")).toBeNull();
  });

  it("flags a failed last run without waiting for the next one", () => {
    // A failed run does not stop the scheduler, so every other card still
    // reads normally and this badge is the only signal that something broke.
    render(
      <SystemStatus
        status={status({ last_execution: execution({ status: "FAILED" }) })}
      />,
    );

    expect(screen.getByText("Last Failed")).toBeTruthy();
    expect(screen.getByText("FAILED")).toBeTruthy();
  });

  it("does not flag a run that is merely still going", () => {
    // `RUNNING` is not `FAILED`: widen the comparison and every ordinary run
    // raises an alert.
    render(
      <SystemStatus
        status={status({ last_execution: execution({ status: "RUNNING" }) })}
      />,
    );

    expect(screen.queryByText("Last Failed")).toBeNull();
    expect(screen.getByText("RUNNING")).toBeTruthy();
  });

  it("says when the last execution was, in the largest unit that fits", () => {
    // Each band boundary is a place to be off by a factor of sixty, and both
    // "45m ago" and "45h ago" read as plausible on a jobs page.
    const ago = (minutes: number) =>
      new Date(NOW.getTime() - minutes * 60_000).toISOString();

    for (const [minutes, expected] of [
      [0, "Just now"],
      [0.9, "Just now"],
      [1, "1m ago"],
      [59, "59m ago"],
      [60, "1h ago"],
      [23 * 60, "23h ago"],
      [24 * 60, "1d ago"],
      [10 * 24 * 60, "10d ago"],
    ] as const) {
      render(
        <SystemStatus
          status={status({
            last_execution: execution({ started_at: ago(minutes) }),
          })}
        />,
      );

      expect(screen.getByText(expected), `${minutes} minutes ago`).toBeTruthy();
      cleanup();
    }
  });

  it("reads a future next run as upcoming, not as the recent past", () => {
    // next_run_time has its own future-facing clock; the past-only one reads a
    // run ten minutes out as "Just now", where an overdue one belongs.
    const ahead = (minutes: number) =>
      new Date(NOW.getTime() + minutes * 60_000).toISOString();

    for (const [minutes, expected] of [
      [10, "in 10m"],
      [2 * 60, "in 2h"],
      [-5, "Just now"],
    ] as const) {
      render(
        <SystemStatus
          status={status({ next_run_time: ahead(minutes), last_execution: null })}
        />,
      );

      expect(screen.getByText(expected), `${minutes} minutes ahead`).toBeTruthy();
      cleanup();
    }
  });

  it("clamps a slightly-future last run to Just now rather than the future", () => {
    // A browser clock a minute behind the DB must not read a fresh run as
    // "in 1m" — the past clock clamps everything at or ahead of now.
    render(
      <SystemStatus
        status={status({
          last_execution: execution({
            started_at: new Date(NOW.getTime() + 90_000).toISOString(),
          }),
        })}
      />,
    );

    expect(screen.getByText("Just now")).toBeTruthy();
  });

  it("says None rather than a date when nothing has ever run", () => {
    render(<SystemStatus status={status({ last_execution: null })} />);

    expect(screen.getByText("None")).toBeTruthy();
    expect(screen.queryByText("Last Failed")).toBeNull();
  });

  it("leaves the active-jobs figure out of the summary when there are none", () => {
    // "Active Jobs" appears twice when there is something to count, and the
    // summary drops its copy at zero, where a "0" would read as a fault.
    render(<SystemStatus status={status({ active_jobs: 0 })} />);
    expect(screen.getAllByText("Active Jobs")).toHaveLength(1);
    cleanup();

    render(<SystemStatus status={status({ active_jobs: 3 })} />);
    expect(screen.getAllByText("Active Jobs")).toHaveLength(2);
  });
});
