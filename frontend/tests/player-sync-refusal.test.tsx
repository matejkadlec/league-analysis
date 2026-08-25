// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderHookWithQueryClient } from "./render-support";

const { validatedGet, validatedPost, toastError, toastInfo, toastWarning } =
  vi.hoisted(() => ({
    validatedGet: vi.fn(),
    validatedPost: vi.fn(),
    toastError: vi.fn(),
    toastInfo: vi.fn(),
    toastWarning: vi.fn(),
  }));

vi.mock("@/lib/core/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/api")>()),
  validatedGet,
  validatedPost,
}));

vi.mock("@/lib/core/hooks", () => ({
  useToast: () => ({
    error: toastError,
    info: toastInfo,
    warning: toastWarning,
    success: vi.fn(),
  }),
}));

import {
  usePlayerProfileUpdate,
  usePlayerSyncRun,
} from "@/features/players/use-player-sync-run";

const PUUID = "player-puuid";
const BUSY_MESSAGE =
  "An update for Faker#KR1 is still running. Showing stored data instead.";

describe("player sync start refusal", () => {
  beforeEach(() => {
    validatedGet.mockReset();
    validatedPost.mockReset();
    toastError.mockReset();
    toastInfo.mockReset();
    toastWarning.mockReset();
  });

  it("reports a SYNC_BUSY refusal as information naming the running player", async () => {
    // The 409 is a refusal, not a failure: no run was created, the click
    // still lands on the target player's stored data, and the backend's
    // sentence says whose update is in the way. An error toast here read as
    // "the feature broke", which is the complaint that led to the 409.
    validatedPost.mockResolvedValue({
      success: false,
      error: {
        kind: "conflict",
        status: 409,
        code: "SYNC_BUSY",
        message: BUSY_MESSAGE,
      },
    });
    const onStartRefused = vi.fn();
    const { result } = renderHookWithQueryClient(() =>
      usePlayerProfileUpdate({ onStartRefused }),
    );

    result.current.mutate({ puuid: PUUID });
    await vi.waitFor(() => expect(onStartRefused).toHaveBeenCalledWith(PUUID));

    expect(toastInfo).toHaveBeenCalledWith("Player update not started", {
      description: BUSY_MESSAGE,
    });
    expect(toastError).not.toHaveBeenCalled();
  });

  it("still reports any other refused start as an error", async () => {
    validatedPost.mockResolvedValue({
      success: false,
      error: { kind: "service", status: 503, message: "unavailable" },
    });
    const { result } = renderHookWithQueryClient(() =>
      usePlayerProfileUpdate(),
    );

    result.current.mutate({ puuid: PUUID });
    await vi.waitFor(() => expect(toastError).toHaveBeenCalled());

    expect(toastInfo).not.toHaveBeenCalled();
  });
});

describe("player sync failure reporting", () => {
  beforeEach(() => {
    validatedGet.mockReset();
    toastError.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("quotes the run's own failure sentence instead of a generic retry prompt", async () => {
    // `_failure_from_job` writes the reviewed client-safe reason onto the
    // run. "Another data update is already running" answers the click that
    // collided with the scheduled fetcher; "Please try again later" hid it.
    const errorMessage =
      "Another data update is already running. Please try again later.";
    validatedGet.mockImplementation(async (_schema: unknown, path: string) => {
      const failed = {
        id: 7,
        puuid: PUUID,
        status: "failed",
        error_code: "SYNC_BUSY",
        error_message: errorMessage,
        match_execution_id: null,
        created_at: "2026-08-16T10:00:00Z",
        updated_at: "2026-08-16T10:00:00Z",
      };
      if (path.endsWith("/sync/active")) {
        return { success: true, data: { ...failed, status: "running" } };
      }
      return { success: true, data: failed };
    });
    renderHookWithQueryClient(() => usePlayerSyncRun(PUUID, {}));

    await vi.advanceTimersByTimeAsync(3_000);

    await vi.waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Player update did not finish", {
        description: errorMessage,
      }),
    );
  });
});
