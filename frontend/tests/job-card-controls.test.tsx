// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { validatedPost, toast } = vi.hoisted(() => ({
  validatedPost: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/lib/core/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/api")>()),
  validatedPost,
}));

vi.mock("@/lib/core/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/hooks")>()),
  useToast: () => ({ toast }),
}));

import { useJobCardControls } from "@/features/jobs/components/use-job-card-controls";
import type { JobConfiguration, JobExecution } from "@/lib/core/schemas";

const JOB: JobConfiguration = {
  id: 7,
  job_type: "MATCH_FETCHER",
  name: "Match Fetcher",
  description: null,
  schedule: "900",
  is_active: true,
  is_paused: false,
  is_running: false,
  is_stopping: false,
  is_force_stopping: false,
  is_test_running: false,
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
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = renderHook(
    () =>
      useJobCardControls({ ...JOB, ...job }, lastExecutionId, recentExecutions),
    {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      ),
    },
  );
  return { ...view, queryClient };
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

afterEach(cleanup);

describe("the one button that does five different things", () => {
  // `handleMainAction` is a cascade over four booleans, and the button is a
  // single icon on an admin page that controls the live scheduler. Every arm
  // sends a different request, and several of them are irreversible.

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

    await waitFor(() => expect(requestedPaths()).toEqual(["/jobs/7/stop"]));
  });

  it("forces the stop only once a graceful stop is already in flight", async () => {
    // The second press is the force. `stopMutation.mutate(isAnyStopping)` is
    // what makes it the second press rather than the first: pass `true` and
    // one click kills a healthy job mid-write; pass `false` and a job wedged
    // in its stopping state can never be forced.
    const { result } = renderControls({ is_running: true, is_stopping: true });

    act(() => result.current.handleMainAction());

    await waitFor(() =>
      expect(requestedPaths()).toEqual(["/jobs/7/stop?force=true"]),
    );
  });

  it("stops the test run rather than the scheduled job when a test is running", async () => {
    // Both can be true at once, and the test branch is checked first for a
    // reason: hitting the regular endpoint here stops production work the
    // admin never touched, and leaves the test running.
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
    ["the scheduled job", { is_running: true }, "/jobs/7/resume"],
    [
      "the test run",
      { is_running: true, is_test_running: true },
      "/jobs/7/test/resume",
    ],
  ])("resumes %s when it is paused", async (_label, flags, path) => {
    const { result } = renderControls({ ...flags, is_paused: true });

    act(() => result.current.handleMainAction());

    await waitFor(() => expect(requestedPaths()).toEqual([path]));
  });

  // The pause control carries its own copy of the paused/running branch that
  // `handleMainAction` also has, so both copies need their own cases. The
  // resume half was missing from the first draft and a mutation to it
  // survived: the main-action test was covering the *other* copy.
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
      { is_running: true, is_test_running: true, is_paused: true },
      "/jobs/7/test/resume",
    ],
  ])("%s %s from the pause control", async (_verb, _label, flags, path) => {
    const { result } = renderControls(flags);

    act(() => result.current.handlePauseResume());

    await waitFor(() => expect(requestedPaths()).toEqual([path]));
  });

  // Each control has three endings: it worked, the server refused, the
  // request never landed. Only the first changes the card, because the job
  // flags come from a refetch — so on either failure the card looks exactly
  // as it did before the press, and the toast is the only thing that says the
  // press did nothing. Without it the admin believes the job is paused.
  const REFUSED = {
    success: true,
    data: {
      success: false,
      message: "no",
      is_running: true,
      is_paused: false,
      is_stopping: false,
      is_force_stopping: false,
    },
  };

  it.each([
    ["refused by the server", REFUSED],
    ["never delivered", { success: false, error: { status: 500 } }],
  ])(
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

  it.each([
    ["refused by the server", REFUSED],
    ["never delivered", { success: false, error: { status: 500 } }],
  ])(
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
    // A trigger the server declines because a run is already in flight is not
    // an error — it is the answer to "is it running?", and the action is to
    // wait rather than to retry or to go read a log. Collapsing it into the
    // failure branch sends the admin looking for a fault that is not there.
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
    // `is_paused` on a job with no run in flight describes the schedule, not
    // a run. Reading it alone turns the main button into "Resume" for a job
    // that has nothing to resume, and the press sends a resume for a run that
    // does not exist.
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
    // The label is the only warning before the press, and the cascade order
    // is what keeps it honest: a stopping job that is also paused must read
    // "Resume", not "Force stop".
    const { result } = renderControls(flags);

    expect(result.current.mainButtonTitle).toBe(title);
  });
});

describe("the manually triggered run's finishing notice", () => {
  // These use `rerender` with new props rather than a fresh render: the whole
  // mechanism lives in refs set by the trigger's `onSuccess`, so a second
  // `renderHook` starts with `awaitingManualRun` false and every assertion
  // below would pass against any implementation at all.
  async function triggerThenReport(executions: JobExecution[]) {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const { result, rerender } = renderHook(
      ({ recent }: { recent: JobExecution[] }) =>
        useJobCardControls(JOB, 99, recent),
      {
        initialProps: { recent: [] as JobExecution[] },
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>
            {children}
          </QueryClientProvider>
        ),
      },
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
      // All three mean "not finished". Fall through them and the toast claims
      // the job completed the moment it starts, which is when it is least
      // true.
      const toasts = await triggerThenReport([execution({ id: 100, status })]);

      expect(toasts).toEqual([]);
    },
  );

  it("ignores a scheduled run that finishes while a manual one is awaited", async () => {
    // The list holds every recent execution, and on a 15-minute schedule a
    // scheduled run finishing first is the normal case. Without the
    // `triggered_by` filter the admin is told their manual run completed
    // while it is still queued.
    const toasts = await triggerThenReport([
      execution({ id: 101, triggered_by: "system" }),
    ]);

    expect(toasts).toEqual([]);
  });

  it("ignores an execution that predates the trigger", async () => {
    // `manualRunBaselineIdRef` is the id of the newest execution at the
    // moment of the press, and `> baselineId` is what stops the *previous*
    // manual run -- already finished, still in the list -- being reported as
    // this one. Without it the toast fires before the new run has a row.
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
      // Four endings that need four different actions from the admin: nothing,
      // wait for Riot, notice someone stopped it, go read the log. Collapsing
      // any pair into one message loses the action.
      const toasts = await triggerThenReport([execution({ id: 100, status })]);

      expect(toasts).toHaveLength(1);
      expect(toasts[0]?.title).toContain(title);
      expect(toasts[0]?.variant).toBe(variant);
    },
  );
});
