// @vitest-environment jsdom

import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithQueryClient } from "./render-support";

type Players = typeof import("@/features/players");
type PlayerContextValue = ReturnType<Players["usePlayerContext"]>;
type Api = typeof import("@/lib/core/api");

const { validatedGet, usePlayerContext } = vi.hoisted(() => ({
  validatedGet: vi.fn<Api["validatedGet"]>(),
  usePlayerContext: vi.fn<Players["usePlayerContext"]>(),
}));

vi.mock("@/lib/core/api", async (importOriginal) => ({
  ...(await importOriginal<Api>()),
  validatedGet,
}));

// `SelectPlayerCard` and `playerQueryOptions` stay real: the empty branch and
// the player query are the page's own wiring. `PlayerCard` opens the stats
// read the RecentPerformanceCard also reads, so it is stubbed.
vi.mock("@/features/players", async (importOriginal) => ({
  ...(await importOriginal<Players>()),
  usePlayerContext,
  PlayerCard: ({
    player,
  }: {
    player: import("@/lib/core/schemas").Player;
  }) => <div data-testid="player-card-stub">{player.game_name}</div>,
}));

// The two aggregate reads stay real; the three cards that consume them are
// stubbed with the props the page is responsible for passing.
vi.mock("@/features/profile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/profile")>()),
  RecentPerformanceCard: ({
    puuid,
    lastUpdated,
  }: {
    puuid: string;
    lastUpdated: string | null;
  }) => (
    <div data-testid="recent-performance-stub">
      recent for {puuid} as of {lastUpdated ?? "never"}
    </div>
  ),
  ChampionStatsCard: ({
    stats,
    dataSourceKey,
  }: {
    stats: { total_champions: number };
    dataSourceKey: string;
  }) => (
    <div data-testid="champion-stats-stub">
      top champions: {stats.total_champions} for {dataSourceKey}
    </div>
  ),
  RoleStatsCard: ({
    stats,
  }: {
    stats: { total_lanes: number };
  }) => <div data-testid="role-stats-stub">roles: {stats.total_lanes}</div>,
}));

vi.mock("@/features/auth", () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

import PlayerOverviewPage from "@/app/player-overview/page";
import { RANKED_SOLO_QUEUE_ID } from "@/features/matches";
import type { ApiResponse } from "@/lib/core/api";
import {
  ChampionStatsResponseSchema,
  LaneStatsResponseSchema,
  PlayerSchema,
} from "@/lib/core/schemas";

const PUUID = "overview-puuid";
const SYNCED_AT = "2026-08-20T02:00:00.000Z";

// Parsed rather than hand-built: the optional counters get their real
// defaults instead of a fixture that drifts from `PlayerSchema`.
const player = PlayerSchema.parse({
  puuid: PUUID,
  game_name: "Overviewed",
  tag_line: "EUNE",
  platform: "eun1",
  summoner_level: 300,
  profile_icon_id: 1,
  match_synced_at: SYNCED_AT,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
});

const championStats = ChampionStatsResponseSchema.parse({
  puuid: PUUID,
  total_champions: 1,
  champions: [
    {
      champion_name: "Ahri",
      champion_id: 103,
      games_played: 4,
      wins: 3,
      losses: 1,
      win_rate: 0.75,
      avg_kills: 5,
      avg_deaths: 4,
      avg_assists: 8,
      avg_kda: 3.25,
    },
  ],
});

const laneStats = LaneStatsResponseSchema.parse({
  puuid: PUUID,
  total_lanes: 2,
  lanes: [
    {
      lane: "Mid",
      games_played: 3,
      wins: 2,
      losses: 1,
      win_rate: 2 / 3,
      avg_kills: 5,
      avg_deaths: 4,
      avg_assists: 8,
      avg_kda: 3.25,
    },
    {
      lane: "Support",
      games_played: 1,
      wins: 1,
      losses: 0,
      win_rate: 1,
      avg_kills: 1,
      avg_deaths: 2,
      avg_assists: 12,
      avg_kda: 6.5,
    },
  ],
});

function answer(url: string): ApiResponse<unknown> {
  if (url === `/players/${PUUID}`) return { success: true, data: player };
  if (url === `/matches/player/${PUUID}/champion-stats`)
    return { success: true, data: championStats };
  return { success: true, data: laneStats };
}

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
  usePlayerContext.mockReturnValue(context());
  validatedGet.mockReset();
  validatedGet.mockImplementation((_schema: unknown, url: string) =>
    Promise.resolve(answer(url)),
  );
});

describe("the player overview page", () => {
  it("asks for a player when none is selected", () => {
    renderWithQueryClient(<PlayerOverviewPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Player Overview" }),
    ).toBeTruthy();
    expect(screen.getByText("Select a player")).toBeTruthy();
    expect(screen.queryByTestId("player-card-stub")).toBeNull();
  });

  it("fills the dashboard for the selected player", async () => {
    usePlayerContext.mockReturnValue(context({ currentPlayer: player }));

    const { queryClient } = renderWithQueryClient(<PlayerOverviewPage />);

    await waitFor(() =>
      expect(screen.getByText("Overviewed")).toBeTruthy(),
    );
    expect(
      screen.getByText(`recent for ${PUUID} as of ${SYNCED_AT}`),
    ).toBeTruthy();
    expect(
      screen.getByText(
        `top champions: 1 for ${PUUID}:queue:${RANKED_SOLO_QUEUE_ID}`,
      ),
    ).toBeTruthy();
    expect(screen.getByText("roles: 2")).toBeTruthy();
    expect(screen.queryByText("Select a player")).toBeNull();
    queryClient.clear();
  });

  it("says so when the player cannot be loaded, instead of an empty dashboard", async () => {
    // The three reads fail independently; the page decides which silence it
    // can live with. A dead player read is not one of them.
    usePlayerContext.mockReturnValue(context({ currentPlayer: player }));
    validatedGet.mockImplementation((_schema: unknown, url: string) =>
      Promise.resolve(
        url === `/players/${PUUID}`
          ? {
              success: false,
              error: {
                status: 500,
                kind: "service",
                message: "The service is unavailable.",
              },
            }
          : answer(url),
      ),
    );

    const { queryClient } = renderWithQueryClient(<PlayerOverviewPage />);

    await waitFor(() =>
      expect(
        screen.getByText("Failed to load player data. Please try again later."),
      ).toBeTruthy(),
    );
    expect(screen.queryByTestId("player-card-stub")).toBeNull();
    expect(screen.queryByTestId("champion-stats-stub")).toBeNull();
    queryClient.clear();
  });
});
