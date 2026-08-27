// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithQueryClient } from "./render-support";

type Players = typeof import("@/features/players");
type PlayerContextValue = ReturnType<Players["usePlayerContext"]>;

const { usePlayerContext } = vi.hoisted(() => ({
  usePlayerContext: vi.fn<Players["usePlayerContext"]>(),
}));

// `SelectPlayerCard` stays real: the empty branch is the page's own answer and
// the card's text is what a visitor actually sees.
vi.mock("@/features/players", async (importOriginal) => ({
  ...(await importOriginal<Players>()),
  usePlayerContext,
}));

vi.mock("@/features/auth", () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

// Both matches components open their own queries; stubbed here so the page's
// branch wiring is the only thing under test.
vi.mock("@/features/matches", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/matches")>()),
  MatchHistory: ({
    puuid,
    lastUpdated,
  }: {
    puuid: string;
    lastUpdated: string | null;
  }) => (
    <div data-testid="match-history-stub">
      history for {puuid}, synced {lastUpdated ?? "never"}
    </div>
  ),
  MatchHistoryLoadingCard: () => <div data-testid="match-history-loading" />,
}));

import MatchHistoryPage from "@/app/match-history/page";
import { PlayerSchema } from "@/lib/core/schemas";

// Parsed rather than hand-built: the optional counters get their real
// defaults instead of a fixture that drifts from `PlayerSchema`.
const player = PlayerSchema.parse({
  puuid: "history-puuid",
  game_name: "Historian",
  tag_line: "EUNE",
  platform: "eun1",
  summoner_level: 300,
  profile_icon_id: 1,
  match_synced_at: "2026-08-20T02:00:00.000Z",
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
});

/** The whole context value, because the mock is typed against the real hook. */
function context(
  overrides: Partial<PlayerContextValue> = {},
): PlayerContextValue {
  return {
    currentPlayer: null,
    isLoading: false,
    selectPlayer: vi.fn<PlayerContextValue["selectPlayer"]>(),
    selectPlayerByPuuid: vi.fn<PlayerContextValue["selectPlayerByPuuid"]>(),
    ...overrides,
  };
}

beforeEach(() => {
  usePlayerContext.mockReset();
});

describe("the match history page", () => {
  it("opens with the page header and a loading card while the player is still loading", () => {
    usePlayerContext.mockReturnValue(context({ isLoading: true }));

    renderWithQueryClient(<MatchHistoryPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Match History" }),
    ).toBeTruthy();
    expect(screen.getByText(/Explore player's matches/)).toBeTruthy();
    expect(screen.getByTestId("match-history-loading")).toBeTruthy();
    expect(screen.queryByTestId("match-history-stub")).toBeNull();
    expect(screen.queryByText("Select a player")).toBeNull();
  });

  it("asks for a player when none is selected", () => {
    usePlayerContext.mockReturnValue(context());

    renderWithQueryClient(<MatchHistoryPage />);

    expect(screen.getByText("Select a player")).toBeTruthy();
    expect(screen.queryByTestId("match-history-stub")).toBeNull();
    expect(screen.queryByTestId("match-history-loading")).toBeNull();
  });

  it("shows the selected player's history, with their last sync", () => {
    usePlayerContext.mockReturnValue(context({ currentPlayer: player }));

    renderWithQueryClient(<MatchHistoryPage />);

    expect(
      screen.getByText("history for history-puuid, synced 2026-08-20T02:00:00.000Z"),
    ).toBeTruthy();
    expect(screen.queryByText("Select a player")).toBeNull();
    expect(screen.queryByTestId("match-history-loading")).toBeNull();
  });
});
