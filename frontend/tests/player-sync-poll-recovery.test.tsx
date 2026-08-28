// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderHookWithQueryClient } from "./support/render-support";

type Api = typeof import("@/lib/core/api");
type AppToast = typeof import("@/lib/core/hooks").appToast;

const { validatedGet, validatedPost } = vi.hoisted(() => ({
  validatedGet: vi.fn<Api["validatedGet"]>(),
  validatedPost: vi.fn<Api["validatedPost"]>(),
}));

vi.mock("@/lib/core/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/api")>()),
  validatedGet,
  validatedPost,
}));

vi.mock("@/lib/core/hooks", () => ({
  useToast: () => ({
    error: vi.fn<AppToast["error"]>(),
    info: vi.fn<AppToast["info"]>(),
    warning: vi.fn<AppToast["warning"]>(),
    success: vi.fn<AppToast["success"]>(),
  }),
}));

import { usePlayerSyncRun } from "@/features/players/components/use-player-sync-run";

type SyncRunOptions = NonNullable<Parameters<typeof usePlayerSyncRun>[1]>;
type OnSettled = NonNullable<SyncRunOptions["onSettled"]>;

const PUUID = "player-puuid";
const RUN_TIMESTAMPS = {
  created_at: "2026-08-16T10:00:00Z",
  updated_at: "2026-08-16T10:00:00Z",
};

function run(status: string) {
  return {
    id: 7,
    puuid: PUUID,
    status,
    match_execution_id: null,
    ...RUN_TIMESTAMPS,
  };
}

/**
 * A backend that reports one running run, fails the exact-status poll for a
 * while, then recovers with a terminal status. `/sync/active` keeps answering
 * throughout: a transient failure is the case under test, not a total outage.
 */
function mockPollThatFailsThenRecovers(recoversAs: string) {
  let exactCalls = 0;
  const failFrom = 1;
  const recoverFrom = 3;
  validatedGet.mockImplementation(async (_schema: unknown, path: string) => {
    if (path.endsWith("/sync/active")) {
      return { success: true, data: run("running") };
    }
    exactCalls += 1;
    if (exactCalls > failFrom && exactCalls < recoverFrom) {
      throw new Error("poll failed");
    }
    return {
      success: true,
      data: run(exactCalls >= recoverFrom ? recoversAs : "running"),
    };
  });
  return () => exactCalls;
}

describe("player sync poll recovery", () => {
  beforeEach(() => {
    validatedGet.mockReset();
    validatedPost.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps polling after the exact-status poll errors", async () => {
    // `refetchInterval` reads `query.state.data`, which survives an error, so
    // the status still says `running` and the interval keeps being consulted —
    // an errored poll backs off to 15s, it does not stop.
    const exactCalls = mockPollThatFailsThenRecovers("completed");
    renderHookWithQueryClient(() => usePlayerSyncRun(PUUID, {}));

    // Long enough for the first poll to succeed, the next to fail, and the
    // failed query to sit at its backed-off interval.
    await vi.advanceTimersByTimeAsync(5_000);
    const afterFirstFailure = exactCalls();
    expect(afterFirstFailure).toBeGreaterThan(1);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(exactCalls()).toBeGreaterThan(afterFirstFailure);
  });

  it("keeps polling when the very first read of the run fails", async () => {
    // The case that made "unreadable forever" real: with no successful read
    // there is no last-known status, so an interval keyed on the payload
    // returned false and the run was never spoken of again.
    let exactCalls = 0;
    validatedGet.mockImplementation(async (_schema: unknown, path: string) => {
      if (path.endsWith("/sync/active")) {
        return { success: true, data: run("running") };
      }
      exactCalls += 1;
      if (exactCalls < 3) {
        throw new Error("poll failed");
      }
      return { success: true, data: run("completed") };
    });
    const onSettled = vi.fn<OnSettled>();
    renderHookWithQueryClient(() => usePlayerSyncRun(PUUID, { onSettled }));

    await vi.advanceTimersByTimeAsync(60_000);

    await vi.waitFor(() => expect(onSettled).toHaveBeenCalled());
    expect(onSettled.mock.calls.map((call) => call[0]?.status)).toEqual([
      "completed",
    ]);
  });

  it("settles once, with the real status, when the poll recovers", async () => {
    // A few seconds of failed polling must not settle the run: the caller acts
    // on that callback, and acting on `null` while the run is still going means
    // acting on partial data, which a later real settle then contradicts.
    const onSettled = vi.fn<OnSettled>();
    mockPollThatFailsThenRecovers("completed");
    renderHookWithQueryClient(() => usePlayerSyncRun(PUUID, { onSettled }));

    await vi.advanceTimersByTimeAsync(60_000);

    await vi.waitFor(() => expect(onSettled).toHaveBeenCalled());
    expect(onSettled.mock.calls.map((call) => call[0]?.status)).toEqual([
      "completed",
    ]);
  });
});
