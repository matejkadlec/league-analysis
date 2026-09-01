// @vitest-environment jsdom

import { act, waitFor } from "@testing-library/react";
import { renderHookWithQueryClient } from "./support/render-support";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { validatedPost, toast } = vi.hoisted(() => ({
  validatedPost: vi.fn<typeof import("@/lib/core/http/api").validatedPost>(),
  toast: vi.fn<typeof import("@/lib/core/hooks").appToast.toast>(),
}));

vi.mock("@/lib/core/http/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/http/api")>()),
  validatedPost,
}));

vi.mock("@/lib/core/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/hooks")>()),
  useToast: () => ({ toast }),
}));

import { useJobCardControls } from "@/features/jobs/components/use-job-card-controls";
import type { ApiResponse } from "@/lib/core/http/api";
import type { JobConfiguration, JobExecution } from "@/lib/core/schemas";

const JOB: JobConfiguration = {
  id: 7,
  job_type: "MATCH_FETCHER",
  name: "Match Fetcher",
  description: null,
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
  config_json: null,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
};

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

/** The path of every request the hook made, in order. */
function requestedPaths() {
  return validatedPost.mock.calls.map((call) => call[1] as string);
}

function renderControls(
  job: Partial<JobConfiguration> = {},
  lastExecutionId: number | null = null,
  recentExecutions: JobExecution[] = [],
) {
  return renderHookWithQueryClient(() =>
    useJobCardControls({ ...JOB, ...job }, lastExecutionId, recentExecutions),
  );
}

beforeEach(() => {
  validatedPost.mockReset();
  validatedPost.mockResolvedValue({
    success: true,
    data: {
      success: true,
      message: "ok",
      is_running: false,
      is_paused: false,
      is_stopping: false,
      is_force_stopping: false,
    },
  });
  toast.mockReset();
});


describe("the one button that does five different things", () => {
  // `handleMainAction` is a cascade over four booleans behind one icon on the
  // live scheduler; every arm sends a different request, several irreversible.

  it("triggers a run when the job is idle", async () => {
    const { result } = renderControls();

    act(() => result.current.handleMainAction());

    await waitFor(() => expect(requestedPaths()).toEqual(["/jobs/7/trigger"]));
  });

  it("asks a running job to stop, without forcing it", async () => {
    // `force` is the argument, not a separate endpoint, so the difference
    // between a graceful stop and a kill is one boolean at one call site.
    const { result } = renderControls({ is_running: true });

    act(() => result.current.handleMainAction());

    await waitFor(() => {
      expect(requestedPaths()).toEqual(["/jobs/7/stop"]);
      // No `force=false` either: the bag is empty unless the force is asked
      // for, so axios sends no query string at all.
      expect(validatedPost.mock.calls[0]?.[3]?.params).toEqual({});
    });
  });

  it("forces the stop only once a graceful stop is already in flight", async () => {
    // `stopMutation.mutate(isAnyStopping)` makes force the second press: `true`
    // kills a healthy job mid-write, `false` leaves a wedged job unforceable.
    const { result } = renderControls({ is_running: true, is_stopping: true });

    act(() => result.current.handleMainAction());

    await waitFor(() => {
      expect(requestedPaths()).toEqual(["/jobs/7/stop"]);
      // The flag rides in validatedPost's params argument now, so the force
      // stays observable one level up from the URL.
      expect(validatedPost.mock.calls[0]?.[3]?.params).toEqual({ force: true });
    });
  });

  it("stops the test run rather than the scheduled job when a test is running", async () => {
    // Both can be true at once, and the test branch is checked first: the
    // regular endpoint stops production work and leaves the test running.
    const { result } = renderControls({
      is_running: true,
      is_test_running: true,
    });

    act(() => result.current.handleMainAction());

    await waitFor(() =>
      expect(requestedPaths()).toEqual(["/jobs/7/test/stop"]),
    );
  });

  it.each([
    ["the scheduled job", { is_running: true, is_paused: true }, "/jobs/7/resume"],
    [
      // The test run resumes on its own flag; the scheduled run's is_paused
      // must not be what routes a click to /test/resume.
      "the test run",
      { is_test_running: true, is_test_paused: true },
      "/jobs/7/test/resume",
    ],
  ])("resumes %s when it is paused", async (_label, flags, path) => {
    const { result } = renderControls(flags);

    act(() => result.current.handleMainAction());

    await waitFor(() => expect(requestedPaths()).toEqual([path]));
  });

  it("sees a paused test run even while the scheduled job reports unpaused", async () => {
    // Pause is per run, so deriving the card's paused state from `is_paused`
    // alone leaves a paused test run looking active.
    const { result } = renderControls({
      is_test_running: true,
      is_test_paused: true,
    });

    act(() => result.current.handleMainAction());

    await waitFor(() =>
      expect(requestedPaths()).toEqual(["/jobs/7/test/resume"]),
    );
  });

  // handleMainAction's paused branch delegates to handlePauseResume, so these
  // cases pin that one shared path still reaches from each button.
  it.each([
    ["pauses", "the scheduled job", { is_running: true }, "/jobs/7/pause"],
    [
      "pauses",
      "the test run",
      { is_running: true, is_test_running: true },
      "/jobs/7/test/pause",
    ],
    [
      "resumes",
      "the scheduled job",
      { is_running: true, is_paused: true },
      "/jobs/7/resume",
    ],
    [
      "resumes",
      "the test run",
      { is_test_running: true, is_test_paused: true },
      "/jobs/7/test/resume",
    ],
    [
      // Routing by isTestRunning alone sends this to /test/resume and parks
      // the paused scheduled run behind every test run.
      "resumes",
      "the paused scheduled run behind a live test run",
      { is_running: true, is_paused: true, is_test_running: true },
      "/jobs/7/resume",
    ],
  ])("%s %s from the pause control", async (_verb, _label, flags, path) => {
    const { result } = renderControls(flags);

    act(() => result.current.handlePauseResume());

    await waitFor(() => expect(requestedPaths()).toEqual([path]));
  });

  // Only success changes the card -- the job flags come from a refetch -- so on
  // failure the toast is the only thing saying the press did nothing.
  const FAILURES: [string, ApiResponse<unknown>][] = [
    [
      "refused by the server",
      {
        success: true,
        data: {
          success: false,
          message: "no",
          is_running: true,
          is_paused: false,
          is_stopping: false,
          is_force_stopping: false,
        },
      },
    ],
    [
      "never delivered",
      {
        success: false,
        error: {
          status: 500,
          kind: "service",
          message: "The service is unavailable.",
        },
      },
    ],
  ];

  it.each(FAILURES)(
    "says so when a pause is %s rather than leaving the card unchanged in silence",
    async (_label, response) => {
      validatedPost.mockResolvedValue(response);
      const { result } = renderControls({ is_running: true });

      act(() => result.current.handlePauseResume());

      await waitFor(() => expect(toast).toHaveBeenCalled());
      const [call] = toast.mock.calls.at(-1) as [
        { title: string; variant: string },
      ];
      expect(call.title).toContain("could not be paused");
      expect(call.variant).toBe("error");
    },
  );

  it.each(FAILURES)(
    "says so when a stop is %s rather than leaving the card unchanged in silence",
    async (_label, response) => {
      validatedPost.mockResolvedValue(response);
      const { result } = renderControls({ is_running: true });

      act(() => result.current.handleMainAction());

      await waitFor(() => expect(toast).toHaveBeenCalled());
      const [call] = toast.mock.calls.at(-1) as [
        { title: string; variant: string },
      ];
      expect(call.title).toContain("could not be stopped");
      expect(call.variant).toBe("error");
    },
  );

  it("tells an admin the job was already running rather than that the trigger failed", async () => {
    // A trigger declined because a run is already in flight is not an error;
    // the failure branch would send the admin hunting a fault that is not there.
    validatedPost.mockResolvedValue({
      success: true,
      data: { success: false, message: "already running", execution_id: null },
    });
    const { result } = renderControls();

    act(() => result.current.handleMainAction());

    await waitFor(() => expect(toast).toHaveBeenCalled());
    const [call] = toast.mock.calls.at(-1) as [
      { title: string; variant: string },
    ];
    expect(call.title).toContain("already running");
    expect(call.variant).toBe("warning");
  });

  it("does not report a job as paused when nothing is running", async () => {
    // `is_paused` with no run in flight describes the schedule, not a run, so
    // reading it alone offers "Resume" with nothing to resume.
    const { result } = renderControls({ is_paused: true });

    expect(result.current.isAnyPaused).toBe(false);
    expect(result.current.mainButtonTitle).toBe("Trigger job now");
  });

  it.each([
    ["Resume", { is_running: true, is_paused: true }],
    ["Force stop the job now", { is_running: true, is_stopping: true }],
    ["End the job early", { is_running: true }],
    ["Trigger job now", {}],
  ])("labels the button %s", (title, flags) => {
    // The label is the only warning before the press: a stopping job that is
    // also paused must read "Resume", not "Force stop".
    const { result } = renderControls(flags);

    expect(result.current.mainButtonTitle).toBe(title);
  });
});

describe("the manually triggered run's finishing notice", () => {
  // `rerender`, not a fresh render: the mechanism lives in refs set by the
  // trigger's `onSuccess`, so a second `renderHook` would assert nothing.
  async function triggerThenReport(executions: JobExecution[]) {
    const { result, rerender } = renderHookWithQueryClient(
      ({ recent }: { recent: JobExecution[] }) =>
        useJobCardControls(JOB, 99, recent),
      { initialProps: { recent: [] as JobExecution[] } },
    );

    await act(async () => {
      result.current.handleMainAction();
    });
    await waitFor(() => expect(validatedPost).toHaveBeenCalled());
    // The "run started" toast is not what these tests are about.
    toast.mockReset();

    await act(async () => {
      rerender({ recent: executions });
    });
    return toast.mock.calls.map(
      ([call]) => call as { title: string; variant: string },
    );
  }

  it.each(["PENDING", "RUNNING", "PAUSED"] as const)(
    "stays quiet while the run is still %s",
    async (status) => {
      // All three mean "not finished"; fall through them and the toast claims
      // the job completed the moment it starts.
      const toasts = await triggerThenReport([execution({ id: 100, status })]);

      expect(toasts).toEqual([]);
    },
  );

  it("ignores a scheduled run that finishes while a manual one is awaited", async () => {
    // A scheduled run finishing first is normal on a 15-minute schedule; without
    // the `triggered_by` filter the manual run is reported while still queued.
    const toasts = await triggerThenReport([
      execution({ id: 101, triggered_by: "system" }),
    ]);

    expect(toasts).toEqual([]);
  });

  it("ignores an execution that predates the trigger", async () => {
    // `baselineIdRef` is the newest execution id at the press, so
    // `> baselineId` stops the previous manual run being reported as this one.
    const toasts = await triggerThenReport([execution({ id: 99 })]);

    expect(toasts).toEqual([]);
  });

  it.each([
    ["SUCCESS", "run finished", "success"],
    ["RATE_LIMITED", "run was rate limited", "warning"],
    ["CANCELLED", "run stopped", "success"],
    ["FAILED", "run failed", "error"],
  ] as const)(
    "reports a %s run as its own outcome",
    async (status, title, variant) => {
      // Four endings needing four different actions: nothing, wait for Riot,
      // notice someone stopped it, read the log. Collapsing a pair loses one.
      const toasts = await triggerThenReport([execution({ id: 100, status })]);

      expect(toasts).toHaveLength(1);
      expect(toasts[0]?.title).toContain(title);
      expect(toasts[0]?.variant).toBe(variant);
    },
  );
});
