// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  cancelMatchmakingAnalysis,
  getLatestMatchmakingAnalysis,
  getMatchmakingAnalysisStatus,
  startMatchmakingAnalysis,
  toast,
} = vi.hoisted(() => ({
  cancelMatchmakingAnalysis: vi.fn(),
  getLatestMatchmakingAnalysis: vi.fn(),
  getMatchmakingAnalysisStatus: vi.fn(),
  startMatchmakingAnalysis: vi.fn(),
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@/lib/core/api", () => ({
  cancelMatchmakingAnalysis,
  getLatestMatchmakingAnalysis,
  getMatchmakingAnalysisStatus,
  startMatchmakingAnalysis,
}));

vi.mock("sonner", () => ({ toast }));

import { MatchmakingAnalysis } from "../features/matchmaking/components/matchmaking-analysis";

const createdAt = "2026-08-09T01:00:00.000Z";

function analysis(
  status:
    | "pending"
    | "in_progress"
    | "waiting_rate_limit"
    | "completed"
    | "failed"
    | "cancelled",
  overrides: Record<string, unknown> = {},
) {
  return {
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
    puuid_progress: {},
    requests_saved: 0,
    rate_limit_reset_at: null,
    ...overrides,
  };
}

function renderComponent() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MatchmakingAnalysis puuid="test-puuid" />
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

  afterEach(() => cleanup());

  it("switches to authoritative running state after the first fast start response", async () => {
    let resolveStart: ((value: unknown) => void) | undefined;
    const startResponse = new Promise((resolve) => {
      resolveStart = resolve;
    });
    getLatestMatchmakingAnalysis.mockResolvedValue({
      success: false,
      error: { status: 404, message: "Not found" },
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
    expect(toast.info).toHaveBeenCalledWith("Matchmaking analysis started");
  });

  it("rehydrates a rate-limit wait as an active cancellable run", async () => {
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
      screen.getByText(/Waiting for rate limit to reset/),
    ).not.toBeNull();
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
      data: { success: true, message: "Analysis cancelled" },
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
    expect(toast.warning).toHaveBeenCalledWith("Analysis cancelled");
  });

  it("shows a safe persisted failure and allows a retry", async () => {
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
      "Analysis finished successfully",
    );
  });
});
