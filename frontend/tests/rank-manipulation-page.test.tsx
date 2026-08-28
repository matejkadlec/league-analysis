// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithQueryClient } from "./support/render-support";

type Players = typeof import("@/features/players");
type AnalyzedPlayer = ReturnType<Players["useAnalyzedPlayer"]>;

const { useAnalyzedPlayer } = vi.hoisted(() => ({
  useAnalyzedPlayer: vi.fn<Players["useAnalyzedPlayer"]>(),
}));

// Only the hook: `PlayerSelector` and `formatRiotId` are what carry the
// player's name onto this page, so they stay real.
vi.mock("@/features/players", async (importOriginal) => ({
  ...(await importOriginal<Players>()),
  useAnalyzedPlayer,
}));

vi.mock("@/features/auth", () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => children,
}));

// The comparison card opens its own run queries; stubbed to surface the
// props the page hands it, with the real selector rendered inside.
vi.mock("@/features/smurf-boost", () => ({
  SmurfBoostDetection: ({
    puuid,
    playerName,
    playerSelector,
  }: {
    puuid: string | null;
    playerName: string | null;
    playerSelector: React.ReactNode;
  }) => (
    <div data-testid="smurf-boost-stub">
      comparing {playerName ?? "no one"} ({puuid ?? "no puuid"})
      {playerSelector}
    </div>
  ),
  SmurfBoostExplanationCard: () => (
    <div data-testid="explanation-stub">what this page does</div>
  ),
}));

import RankManipulationPage from "@/app/rank-manipulation/page";
import { PlayerSchema } from "@/lib/core/schemas";

// Parsed rather than hand-built: the optional counters get their real
// defaults instead of a fixture that drifts from `PlayerSchema`.
const player = PlayerSchema.parse({
  puuid: "manipulation-puuid",
  game_name: "Manipulated",
  tag_line: "TWO",
  platform: "eun1",
  summoner_level: 300,
  profile_icon_id: 1,
  created_at: "2026-08-09T01:00:00.000Z",
  updated_at: "2026-08-09T01:00:00.000Z",
});

function analyzed(overrides: Partial<AnalyzedPlayer> = {}): AnalyzedPlayer {
  return {
    analyzedPlayer: null,
    isLoading: false,
    selectAnalyzedPlayer: vi.fn<AnalyzedPlayer["selectAnalyzedPlayer"]>(),
    ...overrides,
  };
}

beforeEach(() => {
  useAnalyzedPlayer.mockReset();
  useAnalyzedPlayer.mockReturnValue(analyzed());
});

describe("the rank manipulation page", () => {
  it("introduces the comparison and explains the model below it", () => {
    renderWithQueryClient(<RankManipulationPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Rank Manipulation" }),
    ).toBeTruthy();
    expect(
      screen.getByText(/Compare a player's recent ranked games/),
    ).toBeTruthy();
    expect(screen.getByTestId("explanation-stub")).toBeTruthy();
  });

  it("offers the selector with no player preloaded, rather than a dead end", async () => {
    // A "select a player" card would send people to the sidebar search,
    // which navigates away from this route; the selector is on the page.
    renderWithQueryClient(<RankManipulationPage />);

    expect(screen.getByText("comparing no one (no puuid)")).toBeTruthy();
    const searchBox = await screen.findByLabelText(
      "Choose player for comparison",
    );
    expect((searchBox as HTMLInputElement).value).toBe("");
  });

  it("carries the chosen player's name into the comparison and the search box", async () => {
    useAnalyzedPlayer.mockReturnValue(analyzed({ analyzedPlayer: player }));

    renderWithQueryClient(<RankManipulationPage />);

    expect(
      screen.getByText("comparing Manipulated#TWO (manipulation-puuid)"),
    ).toBeTruthy();
    const searchBox = await screen.findByLabelText(
      "Choose player for comparison",
    );
    // Choosing a player re-keys the card, so `initialSearchValue` is the
    // only thing that puts the name into the new selector instance.
    expect((searchBox as HTMLInputElement).value).toBe("Manipulated#TWO");
  });

  it("waits with a skeleton, and no selector, while the player is loading", async () => {
    useAnalyzedPlayer.mockReturnValue(analyzed({ isLoading: true }));

    renderWithQueryClient(<RankManipulationPage />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Rank Manipulation" }),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Choose player for comparison")).toBeNull();
    expect(screen.queryByTestId("smurf-boost-stub")).toBeNull();
    // The explanation is unconditional: it stays up while the comparison
    // above it loads.
    expect(screen.getByTestId("explanation-stub")).toBeTruthy();
  });
});
