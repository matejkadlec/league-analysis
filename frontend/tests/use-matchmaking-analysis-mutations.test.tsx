// @vitest-environment jsdom

import type { Dispatch } from "react";
import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type MatchmakingApi = typeof import("@/features/matchmaking/matchmaking-api");
type AppToast = typeof import("@/lib/core/hooks").appToast;

const {
  cancelMatchmakingAnalysis,
  startMatchmakingAnalysis,
  toastError,
  toastInfo,
  toastSuccess,
} = vi.hoisted(() => ({
  cancelMatchmakingAnalysis: vi.fn<MatchmakingApi["cancelMatchmakingAnalysis"]>(),
  startMatchmakingAnalysis: vi.fn<MatchmakingApi["startMatchmakingAnalysis"]>(),
  toastError: vi.fn<AppToast["error"]>(),
  toastInfo: vi.fn<AppToast["info"]>(),
  toastSuccess: vi.fn<AppToast["success"]>(),
}));

vi.mock("@/features/matchmaking/matchmaking-api", () => ({
  cancelMatchmakingAnalysis,
  startMatchmakingAnalysis,
}));

vi.mock("@/lib/core/hooks", () => ({
  useToast: () => ({
    error: toastError,
    info: toastInfo,
    success: toastSuccess,
    warning: vi.fn<AppToast["warning"]>(),
  }),
}));

import { useMatchmakingAnalysisMutations } from "@/features/matchmaking/components/use-matchmaking-analysis-mutations";
import type { AnalysisUiAction } from "@/features/matchmaking/components/matchmaking-analysis-state";
import {
  matchmakingAnalysisQueryKey,
  matchmakingHistoryQueryKey,
  matchmakingResultsQueryKey,
  matchmakingStatusQueryKey,
} from "@/features/matchmaking/matchmaking-query";
import type { ApiResponse } from "@/lib/core/api";
import {
  MatchmakingAnalysisResponseSchema,
  MessageResponseSchema,
  type MatchmakingAnalysisResponse,
} from "@/lib/core/schemas";
import { renderHookWithQueryClient } from "./render-support";

const createdAt = "2026-08-09T01:00:00.000Z";

// Parsed through the real schema so a fixture production could never receive
// fails here rather than agreeing with a mock's stale shape.
function run(
  overrides: Record<string, unknown> = {},
): MatchmakingAnalysisResponse {
  return MatchmakingAnalysisResponseSchema.parse({
    puuid: "player-puuid",
    status: "in_progress",
    progress: 40,
    total_puuids: 100,
    results: null,
    created_at: createdAt,
    started_at: createdAt,
    completed_at: null,
    error_code: null,
    error_message: null,
    requests_saved: 0,
    rate_limit_reset_at: null,
    params: { match_count: 10, end_date: null },
    ...overrides,
  });
}

function renderMutations(watchingCreatedAt: string | null = null) {
  const dispatch = vi.fn<Dispatch<AnalysisUiAction>>();
  const view = renderHookWithQueryClient(() =>
    useMatchmakingAnalysisMutations(
      "player-puuid",
      watchingCreatedAt,
      dispatch,
      { matchCount: 10, endDate: null },
    ),
  );
  return { ...view, dispatch };
}

describe("starting a matchmaking analysis", () => {
  beforeEach(() => {
    startMatchmakingAnalysis.mockReset();
    toastError.mockReset();
    toastInfo.mockReset();
    toastSuccess.mockReset();
  });

  it("clears the previous run from both caches the moment a start is asked", async () => {
    let resolveStart!: (value: ApiResponse<MatchmakingAnalysisResponse>) => void;
    startMatchmakingAnalysis.mockReturnValue(
      new Promise<ApiResponse<MatchmakingAnalysisResponse>>((resolve) => {
        resolveStart = resolve;
      }),
    );
    const { result, dispatch, queryClient } = renderMutations();
    queryClient.setQueryData(matchmakingAnalysisQueryKey("player-puuid"), run());
    queryClient.setQueryData(matchmakingStatusQueryKey("player-puuid"), run());

    act(() => result.current.startMutation.mutate());

    // In flight: the card must not keep rendering the finished run while its
    // replacement is asked for, and the old run's status polls must stop.
    await waitFor(() =>
      expect(
        queryClient.getQueryData(matchmakingAnalysisQueryKey("player-puuid")),
      ).toBeNull(),
    );
    expect(
      queryClient.getQueryState(matchmakingStatusQueryKey("player-puuid")),
    ).toBeUndefined();
    expect(dispatch).toHaveBeenCalledWith({ type: "start-requested" });
    expect(startMatchmakingAnalysis).toHaveBeenCalledWith(
      "player-puuid",
      10,
      null,
    );

    const started = run({ progress: 55, created_at: "2026-08-09T02:00:00.000Z" });
    await act(async () => {
      resolveStart({ success: true, data: started });
    });

    expect(
      queryClient.getQueryData(matchmakingAnalysisQueryKey("player-puuid")),
    ).toBe(started);
    expect(dispatch).toHaveBeenLastCalledWith({
      type: "start-succeeded",
      createdAt: started.created_at,
      progress: started.progress,
    });
    expect(toastInfo).toHaveBeenCalledWith(
      "Matchmaking analysis started",
      expect.anything(),
    );
  });

  it("reports a refused start on the card and leaves the caches empty", async () => {
    startMatchmakingAnalysis.mockResolvedValue({
      success: false,
      error: {
        message: "The service is unavailable.",
        kind: "service",
        status: 503,
      },
    });
    const { result, dispatch, queryClient } = renderMutations();

    act(() => result.current.startMutation.mutate());

    await waitFor(() =>
      expect(dispatch).toHaveBeenLastCalledWith({
        type: "start-failed",
        message: "The analysis could not be started. Please try again.",
      }),
    );
    expect(result.current.startMutation.isError).toBe(true);
    expect(
      queryClient.getQueryData(matchmakingAnalysisQueryKey("player-puuid")),
    ).toBeNull();
    expect(toastError).toHaveBeenCalledWith(
      "The analysis could not be started. Please try again.",
    );
  });
});

describe("cancelling a matchmaking analysis", () => {
  beforeEach(() => {
    cancelMatchmakingAnalysis.mockReset();
    toastError.mockReset();
    toastInfo.mockReset();
    toastSuccess.mockReset();
  });

  it("refuses to cancel when no run is selected rather than cancelling the latest", async () => {
    // `watchingCreatedAt` is the run the session is actually watching;
    // falling back to "latest" would cancel a run nobody asked about.
    const { result, dispatch } = renderMutations(null);

    act(() => result.current.cancelMutation.mutate());

    await waitFor(() =>
      expect(dispatch).toHaveBeenLastCalledWith({ type: "cancel-failed" }),
    );
    expect(result.current.cancelMutation.isError).toBe(true);
    expect(cancelMatchmakingAnalysis).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "The analysis could not be cancelled. Please try again.",
    );
  });

  it("ends the watch and refreshes the run's caches when a cancel lands", async () => {
    cancelMatchmakingAnalysis.mockResolvedValue({
      success: true,
      data: MessageResponseSchema.parse({ message: "cancelled" }),
    });
    const { result, dispatch, queryClient } = renderMutations(createdAt);
    queryClient.setQueryData(matchmakingAnalysisQueryKey("player-puuid"), run());
    queryClient.setQueryData(matchmakingStatusQueryKey("player-puuid"), run());
    queryClient.setQueryData(matchmakingResultsQueryKey("player-puuid"), {
      seeded: true,
    });
    queryClient.setQueryData(matchmakingHistoryQueryKey("player-puuid"), {
      items: [],
    });

    act(() => result.current.cancelMutation.mutate());

    await waitFor(() =>
      expect(dispatch).toHaveBeenLastCalledWith({ type: "cancel-succeeded" }),
    );
    expect(cancelMatchmakingAnalysis).toHaveBeenCalledWith(
      "player-puuid",
      createdAt,
    );
    expect(dispatch).toHaveBeenNthCalledWith(1, { type: "cancel-requested" });
    // The status polls stop, the run leaves the card, and the surfaces that
    // show finished runs re-read.
    expect(
      queryClient.getQueryState(matchmakingStatusQueryKey("player-puuid")),
    ).toBeUndefined();
    expect(
      queryClient.getQueryData(matchmakingAnalysisQueryKey("player-puuid")),
    ).toBeNull();
    expect(
      queryClient.getQueryState(matchmakingResultsQueryKey("player-puuid"))
        ?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(matchmakingHistoryQueryKey("player-puuid"))
        ?.isInvalidated,
    ).toBe(true);
    expect(toastSuccess).toHaveBeenCalledWith(
      "Matchmaking analysis cancelled",
      expect.anything(),
    );
  });
});
