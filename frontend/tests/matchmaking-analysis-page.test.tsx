// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { renderWithQueryClient } from "./render-support";

const { useAnalyzedPlayer } = vi.hoisted(() => ({
  useAnalyzedPlayer: vi.fn(),
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

// The four cards the chosen-player branch mounts. Stubbed because each opens
// its own analysis queries and this asserts the page's wiring, not theirs --
// but `MatchmakingAnalysis` has to keep rendering the selector handed to it,
// since that is where the control lives once a player is chosen.
vi.mock("@/features/matchmaking", () => ({
  MatchmakingAnalysis: ({ playerSelector }: { playerSelector: React.ReactNode }) => (
    <div>{playerSelector}</div>
  ),
  MatchmakingAnalysisResults: () => null,
  MatchmakingAnalysisHistory: () => null,
  MatchmakingExplanationCard: () => null,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

import MatchmakingAnalysisPage from "../app/matchmaking-analysis/page";

const player = {
  puuid: "stranger-puuid",
  game_name: "Stranger",
  tag_line: "TWO",
  platform: "eun1",
};

beforeEach(() => {
  useAnalyzedPlayer.mockReset();
});

it("carries the chosen player's name into the search box", async () => {
  useAnalyzedPlayer.mockReturnValue({
    analyzedPlayer: null,
    isLoading: false,
    selectAnalyzedPlayer: vi.fn(),
  });

  const { rerender } = renderWithQueryClient(<MatchmakingAnalysisPage />);
  const emptyBox = await screen.findByLabelText("Choose player for analysis");
  expect((emptyBox as HTMLInputElement).value).toBe("");

  // Choosing a player swaps the whole branch: the "choose someone" card gives
  // way to the analysis cards, and the selector is mounted afresh inside them.
  // `initialSearchValue` is the only thing that puts the name into that new
  // instance -- drop it and the box comes up blank beside an analysis that is
  // about somebody, with no way to tell who.
  useAnalyzedPlayer.mockReturnValue({
    analyzedPlayer: player,
    isLoading: false,
    selectAnalyzedPlayer: vi.fn(),
  });
  rerender(<MatchmakingAnalysisPage />);

  const seededBox = await screen.findByLabelText("Choose player for analysis");
  expect((seededBox as HTMLInputElement).value).toBe("Stranger#TWO");
});
