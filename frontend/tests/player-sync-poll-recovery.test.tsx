// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderHookWithQueryClient } from "./support/render-support";

type Api = typeof import("@/lib/core/http/api");
type AppToast = typeof import("@/lib/core/hooks").appToast;

const { validatedGet, validatedPost } = vi.hoisted(() => ({
  validatedGet: vi.fn<Api["validatedGet"]>(),
  validatedPost: vi.fn<Api["validatedPost"]>(),
}));

vi.mock("@/lib/core/http/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/http/api")>()),
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
 * The exact-status poll fails for a while, then recovers. `/sync/active` keeps
 * answering: the case under test is a transient failure, not an outage.
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
    // an errored poll backs off to 15s rather than stopping.
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
    // With no successful read there is no last-known status, so an interval
    // keyed on the payload returns false and the run is never read again.
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
    // Failed polling must not settle the run: the caller would act on partial
    // data that a later real settle then contradicts.
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
