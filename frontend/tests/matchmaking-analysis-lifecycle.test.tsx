// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type MatchmakingApi = typeof import("@/features/matchmaking/matchmaking-api");
type SonnerToast = typeof import("sonner").toast;

const {
  cancelMatchmakingAnalysis,
  getLatestMatchmakingAnalysis,
  getMatchmakingAnalysisStatus,
  startMatchmakingAnalysis,
  toast,
} = vi.hoisted(() => ({
  cancelMatchmakingAnalysis:
    vi.fn<MatchmakingApi["cancelMatchmakingAnalysis"]>(),
  getLatestMatchmakingAnalysis:
    vi.fn<MatchmakingApi["getLatestMatchmakingAnalysis"]>(),
  getMatchmakingAnalysisStatus:
    vi.fn<MatchmakingApi["getMatchmakingAnalysisStatus"]>(),
  startMatchmakingAnalysis: vi.fn<MatchmakingApi["startMatchmakingAnalysis"]>(),
  toast: {
    error: vi.fn<SonnerToast["error"]>(),
    info: vi.fn<SonnerToast["info"]>(),
    success: vi.fn<SonnerToast["success"]>(),
    warning: vi.fn<SonnerToast["warning"]>(),
  },
}));

vi.mock("@/features/matchmaking/matchmaking-api", () => ({
  cancelMatchmakingAnalysis,
  getLatestMatchmakingAnalysis,
  getMatchmakingAnalysisStatus,
  startMatchmakingAnalysis,
}));

vi.mock("sonner", () => ({ toast }));

import { MatchmakingAnalysis } from "../features/matchmaking/components/matchmaking-analysis";
import {
  appendThroughputSample,
  estimateMatchmakingMinutesRemaining,
  observedPlayersPerSecond,
  projectMatchmakingProgress,
  type ThroughputSample,
} from "../features/matchmaking/matchmaking-progress";
import type { ApiResponse } from "@/lib/core/http/api";
import {
  MatchmakingAnalysisResponseSchema,
  type MatchmakingAnalysisResponse,
  type MatchmakingAnalysisStatus,
} from "@/lib/core/schemas";

const createdAt = "2026-08-09T01:00:00.000Z";

// Parsed through the real schema so a fixture that production could never
// receive fails here rather than agreeing with a mock's stale shape.
function analysis(
  status: MatchmakingAnalysisStatus,
  overrides: Record<string, unknown> = {},
): MatchmakingAnalysisResponse {
  return MatchmakingAnalysisResponseSchema.parse({
    puuid: "test-puuid",
    status,
    progress: 0,
    total_puuids: 100,
    results: null,
    created_at: createdAt,
    started_at: status === "pending" ? null : createdAt,
    completed_at: ["completed", "failed", "cancelled"].includes(status)
      ? createdAt
      : null,
    error_code: null,
    error_message: null,
    requests_saved: 0,
    rate_limit_reset_at: null,
    params: { match_count: 10, end_date: null },
    ...overrides,
  });
}

function renderComponent(existingQueryClient?: QueryClient) {
  const queryClient =
    existingQueryClient ??
    new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  render(
    <QueryClientProvider client={queryClient}>
      <MatchmakingAnalysis
        puuid="test-puuid"
        analyzedPlayerLabel="Analyzed#ONE"
        playerSelector={<input aria-label="Choose player for analysis" />}
      />
    </QueryClientProvider>,
  );
  return queryClient;
}

describe("MatchmakingAnalysis lifecycle", () => {
  beforeEach(() => {
    cancelMatchmakingAnalysis.mockReset();
    getLatestMatchmakingAnalysis.mockReset();
    getMatchmakingAnalysisStatus.mockReset();
    startMatchmakingAnalysis.mockReset();
    Object.values(toast).forEach((mock) => mock.mockReset());
  });


  it("switches to authoritative running state after the first fast start response", async () => {
    let resolveStart:
      | ((value: ApiResponse<MatchmakingAnalysisResponse>) => void)
      | undefined;
    const startResponse = new Promise<ApiResponse<MatchmakingAnalysisResponse>>(
      (resolve) => {
        resolveStart = resolve;
      },
    );
    getLatestMatchmakingAnalysis.mockResolvedValue({
      success: false,
      error: { kind: "not-found", status: 404, message: "Not found" },
    });
    getMatchmakingAnalysisStatus.mockResolvedValue({
      success: true,
      data: analysis("pending"),
    });
    startMatchmakingAnalysis.mockReturnValue(startResponse);
    const user = userEvent.setup();
    renderComponent();

    const startButton = await screen.findByRole("button", {
      name: "Start Analysis",
    });
    await user.click(startButton);

    expect(screen.queryByRole("button", { name: "Start Analysis" })).toBeNull();
    expect(startMatchmakingAnalysis).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveStart?.({ success: true, data: analysis("pending") });
      await startResponse;
    });

    expect(
      await screen.findByRole("button", { name: "Cancel Analysis" }),
    ).not.toBeNull();
    expect(screen.getByText("0 / 100 players")).not.toBeNull();
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === "P" &&
          element.textContent ===
            "Running matchmaking analysis for Analyzed#ONE.",
      ),
    ).not.toBeNull();
    expect(toast.info).toHaveBeenCalledWith("Matchmaking analysis started", {
      description: "Progress will update here while the analysis runs.",
    });
  });

  it("keeps a rate-limit wait user-facing as an active analysis", async () => {
    const waiting = analysis("waiting_rate_limit", {
      progress: 37,
      rate_limit_reset_at: new Date(Date.now() + 60_000).toISOString(),
    });
    getLatestMatchmakingAnalysis.mockResolvedValue({
      success: true,
      data: waiting,
    });
    getMatchmakingAnalysisStatus.mockResolvedValue({
      success: true,
      data: waiting,
    });
    renderComponent();

    expect(
      await screen.findByRole("button", { name: "Cancel Analysis" }),
    ).not.toBeNull();
    expect(await screen.findByText("37 / 100 players")).not.toBeNull();
    expect(
      screen.getByText(
        /Analyzing 37 of 100 players \(~\d+ minutes remaining\)/,
      ),
    ).not.toBeNull();
    expect(screen.queryByText(/rate limit/i)).toBeNull();
  });

  it("projects ETA and visual progress smoothly between backend milestones", () => {
    const anchorTimestamp = Date.parse(createdAt);
    const projection = {
      analysisCreatedAt: createdAt,
      anchorProgress: 17,
      anchorTimestamp,
      authoritativeProgress: 17,
      totalPlayers: 100,
    };

    const initial = projectMatchmakingProgress({
      ...projection,
      nowTimestamp: anchorTimestamp,
    });
    const afterOneMinute = projectMatchmakingProgress({
      ...projection,
      nowTimestamp: anchorTimestamp + 60_000,
    });
    const atNextWindow = projectMatchmakingProgress({
      ...projection,
      authoritativeProgress: 34,
      nowTimestamp: anchorTimestamp + 120_000,
    });

    // Interpolation rate is 100/7 players per 120s window (the rank read
    // added a seventh request per player).
    expect(Math.round(initial)).toBe(17);
    expect(Math.round(afterOneMinute)).toBe(24);
    expect(Math.round(atNextWindow)).toBe(34);
    expect(estimateMatchmakingMinutesRemaining(initial, 100)).toBe(12);
    expect(estimateMatchmakingMinutesRemaining(afterOneMinute, 100)).toBe(11);
  });

  it("trusts the recent observed pace over the static rate", () => {
    // 30 players in the last 30 seconds: 70 remaining ≈ 70s → 2 minutes.
    expect(estimateMatchmakingMinutesRemaining(30, 100, 1)).toBe(2);
    // A rate-limited crawl reports the slower pace honestly.
    expect(estimateMatchmakingMinutesRemaining(10, 100, 1 / 60)).toBe(90);
    // No usable window yet → the static warm-cache rate applies.
    expect(estimateMatchmakingMinutesRemaining(17, 100, null)).toBe(12);
  });

  it("measures pace over a trailing window so a cache burst ages out", () => {
    const t0 = 1_000_000;
    let samples: ThroughputSample[] = [];
    // A cached prefix races to 400 players in 10 seconds...
    samples = appendThroughputSample(samples, t0, 0);
    samples = appendThroughputSample(samples, t0 + 10_000, 400);
    // ...too short a span to extrapolate from yet.
    expect(observedPlayersPerSecond(samples)).toBeNull();

    // Sixty-plus seconds later the burst has aged out of the window and
    // only the cold pace remains: 6 players over the trailing 60s.
    samples = appendThroughputSample(samples, t0 + 40_000, 406);
    samples = appendThroughputSample(samples, t0 + 70_000, 409);
    samples = appendThroughputSample(samples, t0 + 100_000, 412);
    expect(samples[0]?.timestamp).toBe(t0 + 40_000);
    expect(observedPlayersPerSecond(samples)).toBeCloseTo(0.1, 10);

    // A stalled window (rate-limit wait) yields null, not a zero division.
    const stalled = [
      { timestamp: t0, progress: 50 },
      { timestamp: t0 + 30_000, progress: 50 },
    ];
    expect(observedPlayersPerSecond(stalled)).toBeNull();

    // A progress drop means a new run took over; history resets with it.
    expect(appendThroughputSample(samples, t0 + 101_000, 3)).toHaveLength(1);
  });

  it("cancels the exact persisted run and keeps the UI retryable", async () => {
    const active = analysis("in_progress", { progress: 12 });
    getLatestMatchmakingAnalysis
      .mockResolvedValueOnce({ success: true, data: active })
      .mockResolvedValue({ success: true, data: analysis("cancelled") });
    getMatchmakingAnalysisStatus.mockResolvedValue({
      success: true,
      data: active,
    });
    cancelMatchmakingAnalysis.mockResolvedValue({
      success: true,
      data: { message: "Analysis cancelled" },
    });
    const user = userEvent.setup();
    renderComponent();

    await user.click(
      await screen.findByRole("button", { name: "Cancel Analysis" }),
    );

    await waitFor(() => {
      expect(cancelMatchmakingAnalysis).toHaveBeenCalledWith(
        "test-puuid",
        createdAt,
      );
    });
    expect(
      await screen.findByRole("button", { name: "Run New Analysis" }),
    ).not.toBeNull();
    expect(toast.success).toHaveBeenCalledWith(
      "Matchmaking analysis cancelled",
      { description: "The selected analysis run is no longer active." },
    );
  });

  it("shows a safe current-session failure and clears it for a new run", async () => {
    const active = analysis("in_progress");
    const failed = analysis("failed", {
      error_code: "analysis_failed",
      error_message: "The analysis did not finish. Please try again.",
    });
    getLatestMatchmakingAnalysis.mockResolvedValue({
      success: true,
      data: active,
    });
    getMatchmakingAnalysisStatus.mockResolvedValue({
      success: true,
      data: failed,
    });
    renderComponent();

    expect(
      await screen.findByText("The analysis did not finish. Please try again."),
    ).not.toBeNull();
    expect(
      await screen.findByRole("button", { name: "Run New Analysis" }),
    ).not.toBeNull();
    expect(toast.error).toHaveBeenCalledWith(
      "The analysis did not finish. Please try again.",
    );

    startMatchmakingAnalysis.mockReturnValue(
      new Promise<ApiResponse<MatchmakingAnalysisResponse>>(() => undefined),
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Run New Analysis" }));
    expect(
      screen.queryByText("The analysis did not finish. Please try again."),
    ).toBeNull();
  });

  it("does not resurrect a prior failure after navigation or a fresh mount", async () => {
    const active = analysis("in_progress");
    const failed = analysis("failed", {
      error_code: "riot_service_error",
      error_message:
        "Riot data could not be loaded for this analysis. Please try again.",
    });
    getLatestMatchmakingAnalysis.mockResolvedValue({
      success: true,
      data: active,
    });
    getMatchmakingAnalysisStatus.mockResolvedValue({
      success: true,
      data: failed,
    });
    const queryClient = renderComponent();

    expect(
      await screen.findByText(
        "Riot data could not be loaded for this analysis. Please try again.",
      ),
    ).not.toBeNull();

    cleanup();
    getLatestMatchmakingAnalysis.mockResolvedValue({
      success: true,
      data: failed,
    });
    renderComponent(queryClient);

    expect(
      await screen.findByRole("button", { name: "Run New Analysis" }),
    ).not.toBeNull();
    expect(
      screen.queryByText(
        "Riot data could not be loaded for this analysis. Please try again.",
      ),
    ).toBeNull();
  });

  it("refreshes the latest result and history after authoritative completion", async () => {
    const active = analysis("in_progress", { progress: 6 });
    const completed = analysis("completed", {
      progress: 100,
      results: {
        team_avg_winrate: 0.51,
        enemy_avg_winrate: 0.49,
        matches_analyzed: 910,
      },
    });
    getLatestMatchmakingAnalysis
      .mockResolvedValueOnce({ success: true, data: active })
      .mockResolvedValue({ success: true, data: completed });
    getMatchmakingAnalysisStatus.mockResolvedValue({
      success: true,
      data: completed,
    });
    const queryClient = renderComponent();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    await waitFor(
      () => {
        expect(invalidate).toHaveBeenCalledWith({
          queryKey: ["matchmaking-analysis-results", "test-puuid"],
        });
        expect(invalidate).toHaveBeenCalledWith({
          queryKey: ["matchmaking-analysis-history", "test-puuid"],
        });
      },
      { timeout: 5_000 },
    );
    expect(
      await screen.findByRole("button", { name: "Run New Analysis" }),
    ).not.toBeNull();
    expect(toast.success).toHaveBeenCalledWith(
      "Matchmaking analysis finished",
      { description: "The latest results and history are ready." },
    );
  });

  it("resolves a missing analysis to an empty state instead of an error", async () => {
    getLatestMatchmakingAnalysis.mockResolvedValue({
      success: false,
      error: {
        kind: "not-found",
        status: 404,
        message: "The requested item could not be found.",
      },
    });
    const queryClient = renderComponent();

    expect(
      await screen.findByRole("button", { name: "Start Analysis" }),
    ).not.toBeNull();
    expect(screen.queryByText("Loading analysis...")).toBeNull();

    const state = queryClient.getQueryState([
      "matchmaking-analysis",
      "test-puuid",
    ]);
    expect(state?.status).toBe("success");
    expect(state?.data).toBeNull();
  });

  it("fails the query on other errors while the card stays usable", async () => {
    getLatestMatchmakingAnalysis.mockResolvedValue({
      success: false,
      error: {
        kind: "service",
        status: 500,
        message:
          "The League Analysis service could not complete the request. Please try again later.",
      },
    });
    const queryClient = renderComponent();

    expect(
      await screen.findByRole("button", { name: "Start Analysis" }),
    ).not.toBeNull();
    expect(screen.queryByText("Loading analysis...")).toBeNull();

    await waitFor(() => {
      const state = queryClient.getQueryState([
        "matchmaking-analysis",
        "test-puuid",
      ]);
      expect(state?.status).toBe("error");
    });
  });
});
