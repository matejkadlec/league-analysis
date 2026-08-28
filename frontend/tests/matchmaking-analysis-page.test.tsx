// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { renderWithQueryClient } from "./support/render-support";

type Players = typeof import("@/features/players");
type AnalyzedPlayer = ReturnType<Players["useAnalyzedPlayer"]>;
type SonnerToast = typeof import("sonner").toast;

const { useAnalyzedPlayer } = vi.hoisted(() => ({
  useAnalyzedPlayer: vi.fn<Players["useAnalyzedPlayer"]>(),
}));

// Only the hook: `PlayerSelector` and `formatRiotId` are what this is about,
// so they stay real.
vi.mock("@/features/players", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/players")>()),
  useAnalyzedPlayer,
}));

vi.mock("@/features/auth", () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => children,
}));

// The four cards the chosen-player branch mounts, stubbed because each opens
// its own analysis queries. `MatchmakingAnalysis` still has to render the
// selector handed to it -- that is where the control lives.
vi.mock("@/features/matchmaking", () => ({
  MatchmakingAnalysis: ({ playerSelector }: { playerSelector: React.ReactNode }) => (
    <div>{playerSelector}</div>
  ),
  MatchmakingAnalysisResults: () => null,
  MatchmakingAnalysisHistory: () => null,
  MatchmakingExplanationCard: () => null,
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn<SonnerToast["error"]>(),
    info: vi.fn<SonnerToast["info"]>(),
    success: vi.fn<SonnerToast["success"]>(),
    warning: vi.fn<SonnerToast["warning"]>(),
  },
}));

import MatchmakingAnalysisPage from "../app/matchmaking-analysis/page";
import { PlayerSchema } from "@/lib/core/schemas";

// Parsed rather than hand-built: the optional counters get their real
// defaults instead of a fixture that drifts from `PlayerSchema`.
const player = PlayerSchema.parse({
  puuid: "stranger-puuid",
  game_name: "Stranger",
  tag_line: "TWO",
  platform: "eun1",
  summoner_level: 300,
  profile_icon_id: 1,
  created_at: "2026-08-09T01:00:00.000Z",
  updated_at: "2026-08-09T01:00:00.000Z",
});

beforeEach(() => {
  useAnalyzedPlayer.mockReset();
});

it("carries the chosen player's name into the search box", async () => {
  useAnalyzedPlayer.mockReturnValue({
    analyzedPlayer: null,
    isLoading: false,
    selectAnalyzedPlayer: vi.fn<AnalyzedPlayer["selectAnalyzedPlayer"]>(),
  });

  const { rerender } = renderWithQueryClient(<MatchmakingAnalysisPage />);
  const emptyBox = await screen.findByLabelText("Choose player for analysis");
  expect((emptyBox as HTMLInputElement).value).toBe("");

  // Choosing a player swaps the whole branch and the selector is mounted
  // afresh inside it, so `initialSearchValue` is the only thing that puts the
  // name into the new instance.
  useAnalyzedPlayer.mockReturnValue({
    analyzedPlayer: player,
    isLoading: false,
    selectAnalyzedPlayer: vi.fn<AnalyzedPlayer["selectAnalyzedPlayer"]>(),
  });
  rerender(<MatchmakingAnalysisPage />);

  const seededBox = await screen.findByLabelText("Choose player for analysis");
  expect((seededBox as HTMLInputElement).value).toBe("Stranger#TWO");
});
