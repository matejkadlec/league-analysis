// @vitest-environment jsdom

import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

type MatchmakingApi = typeof import("@/features/matchmaking/matchmaking-api");
type SonnerToast = typeof import("sonner").toast;

const {
  cancelMatchmakingAnalysis,
  getMatchmakingAnalysisStatus,
  startMatchmakingAnalysis,
  toast,
} = vi.hoisted(() => ({
  cancelMatchmakingAnalysis:
    vi.fn<MatchmakingApi["cancelMatchmakingAnalysis"]>(),
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
  getMatchmakingAnalysisStatus,
  startMatchmakingAnalysis,
}));

vi.mock("sonner", () => ({ toast }));

import { MatchmakingAnalysisSession } from "@/features/matchmaking/components/matchmaking-analysis-session";
import type { ApiResponse } from "@/lib/core/api";
import {
  MatchmakingAnalysisResponseSchema,
  type MatchmakingAnalysisResponse,
  type MatchmakingAnalysisStatus,
} from "@/lib/core/schemas";
import { renderWithQueryClient } from "./support/render-support";

const createdAt = "2026-08-09T01:00:00.000Z";

// Parsed through the real schema so a fixture the API could never send fails
// here rather than agreeing with a mock's stale shape.
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

function answerStatusWith(run: MatchmakingAnalysisResponse | null) {
  getMatchmakingAnalysisStatus.mockResolvedValue(
    run
      ? ({ success: true, data: run } as ApiResponse<MatchmakingAnalysisResponse>)
      : {
          success: false,
          error: { kind: "not-found", status: 404, message: "Not found" },
        },
  );
}

function renderSession(latestAnalysis: MatchmakingAnalysisResponse | null) {
  return renderWithQueryClient(
    <MatchmakingAnalysisSession
      puuid="test-puuid"
      analyzedPlayerLabel="Analyzed#ONE"
      playerSelector={<input aria-label="Choose player for analysis" />}
      latestAnalysis={latestAnalysis}
    />,
  );
}

describe("the matchmaking analysis session", () => {
  beforeEach(() => {
    cancelMatchmakingAnalysis.mockReset();
    getMatchmakingAnalysisStatus.mockReset();
    startMatchmakingAnalysis.mockReset();
    Object.values(toast).forEach((mock) => mock.mockReset());
  });

  it("attaches to the active run the page handed it and watches that exact run", async () => {
    const active = analysis("in_progress", { progress: 12 });
    answerStatusWith(active);
    const user = userEvent.setup();

    renderSession(active);

    // The session adopts the run handed down through `latestAnalysis` as its
    // own: its counter, its cancel button, and a status watch keyed to the
    // run's `created_at` — not to the player alone.
    const cancel = await screen.findByRole("button", {
      name: "Cancel Analysis",
    });
    expect(screen.getByText("12 / 100 players")).toBeTruthy();
    await waitFor(() => {
      expect(getMatchmakingAnalysisStatus).toHaveBeenCalledWith(
        "test-puuid",
        createdAt,
        expect.any(AbortSignal),
      );
    });

    cancelMatchmakingAnalysis.mockResolvedValue({
      success: true,
      data: { message: "Analysis cancelled" },
    });
    await user.click(cancel);

    await waitFor(() => {
      expect(cancelMatchmakingAnalysis).toHaveBeenCalledWith(
        "test-puuid",
        createdAt,
      );
    });
  });

  it("starts a run with the match count and end date the form collected", async () => {
    startMatchmakingAnalysis.mockReturnValue(
      new Promise<ApiResponse<MatchmakingAnalysisResponse>>(() => undefined),
    );

    renderSession(null);

    // The start card's controls are the session's own state; changing them
    // here proves the wiring that carries the form into the start request.
    // A date input is set whole, not typed digit by digit.
    fireEvent.click(screen.getByRole("button", { name: "20" }));
    fireEvent.change(screen.getByLabelText("Last day to include (optional)"), {
      target: { value: "2026-08-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start Analysis" }));

    await waitFor(() => {
      expect(startMatchmakingAnalysis).toHaveBeenCalledWith(
        "test-puuid",
        20,
        "2026-08-01",
      );
    });
    // In flight is visible: the form swaps for the active card. Before the
    // first status answer the expected player count is still the 10-match
    // default; the ETA is the static estimate, so it is matched loosely.
    expect(
      await screen.findByText(/Analyzing 0 of 100 players/),
    ).toBeTruthy();
  });

  it("offers a fresh run once the latest one is finished", async () => {
    renderSession(analysis("completed", { progress: 100 }));

    expect(
      await screen.findByRole("button", { name: "Run New Analysis" }),
    ).toBeTruthy();
    // A completed run is not something to cancel or watch.
    expect(
      screen.queryByRole("button", { name: "Cancel Analysis" }),
    ).toBeNull();
    expect(getMatchmakingAnalysisStatus).not.toHaveBeenCalled();
  });

  it("ends the watch quietly when the watched run disappears", async () => {
    // A 404 from the status endpoint is the ordinary end of a watch -- the
    // record was deleted -- so the session resolves it to "nothing to
    // report" instead of throwing a toast at the reader.
    answerStatusWith(null);

    renderSession(analysis("in_progress", { progress: 12 }));

    expect(
      await screen.findByRole("button", { name: "Cancel Analysis" }),
    ).toBeTruthy();
    await waitFor(() => {
      expect(getMatchmakingAnalysisStatus).toHaveBeenCalled();
    });
    expect(toast.error).not.toHaveBeenCalled();
  });
});
