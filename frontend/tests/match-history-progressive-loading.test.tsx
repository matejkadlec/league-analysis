// @vitest-environment jsdom

import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithQueryClient } from "./render-support";

const { validatedGet, validatedPost } = vi.hoisted(() => ({
  validatedGet: vi.fn(),
  validatedPost: vi.fn(),
}));

vi.mock("@/lib/core/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/api")>()),
  validatedGet,
  validatedPost,
}));

vi.mock("@/lib/core/hooks", () => ({
  useToast: () => ({
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/core/data-dragon-context", () => ({
  useDDragonVersion: () => "16.1.1",
}));

vi.mock("@/lib/core/use-relative-time", () => ({
  useRelativeTime: () => "just now",
}));

import { MatchHistory } from "@/features/matches/components/match-history";
import { installMemoryLocalStorage } from "./test-browser-storage";

installMemoryLocalStorage();

const PUUID = "player-puuid";

function participant(overrides: Record<string, unknown> = {}) {
  return {
    champion_id: 82,
    champion_name: "Mordekaiser",
    champion_level: 16,
    team_position: "TOP",
    team_id: 100,
    win: true,
    remake: false,
    kills: 4,
    deaths: 9,
    assists: 2,
    kda: 0.67,
    total_cs: 150,
    vision_score: 12,
    total_damage_dealt_to_champions: 20000,
    summoner1_id: 4,
    summoner2_id: 12,
    runes: { primary_style: 8000, sub_style: 8400, keystone: 8010 },
    ...overrides,
  };
}

function match(index: number) {
  return {
    match_id: `EUN1_${index}`,
    platform: "eun1",
    game_creation_timestamp: 1_700_000_000_000,
    game_start_timestamp: 1_700_000_000_000,
    game_start_timestamp_source: "riot_game_start",
    game_duration: 1800,
    queue_id: 420,
    game_version: "16.1.555.5555",
    map_id: 11,
    game_mode: "CLASSIC",
    game_type: "MATCHED_GAME",
    game_end_timestamp: 1_700_001_800_000,
    early_surrender: false,
    surrender: false,
    game_result: null,
    fully_analyzed: true,
    created_at: "2026-08-16T10:00:00Z",
    updated_at: "2026-08-16T10:00:00Z",
    player_participant: participant(),
    lane_opponent: participant({
      champion_name: "DrMundo",
      puuid: "enemy-puuid",
      game_name: "Enemy",
      tag_line: "EUW",
    }),
    lp_change: 18,
    team_compositions: null,
    team_stats: null,
  };
}

const RUN_TIMESTAMPS = {
  created_at: "2026-08-16T10:00:00Z",
  updated_at: "2026-08-16T10:00:00Z",
};

/**
 * @param storedMatches how many rows the backend has persisted so far
 * @param runStatus `running` while the update is still storing matches
 */
function mockHistory(storedMatches: number, runStatus: string | null): void {
  const run =
    runStatus === null
      ? null
      : { id: 7, puuid: PUUID, status: runStatus, ...RUN_TIMESTAMPS };
  validatedGet.mockImplementation(async (_schema: unknown, path: string) => {
    if (path.endsWith("/sync/active")) {
      return { success: true, data: run };
    }
    if (path.includes("/sync/")) {
      return { success: true, data: run };
    }
    if (path.includes("/stats")) {
      return {
        success: true,
        data: {
          puuid: PUUID,
          total_matches: storedMatches,
          wins: storedMatches,
          losses: 0,
          win_rate: 1,
        },
      };
    }
    return {
      success: true,
      data: {
        // One page's worth at most, which is all the card ever renders.
        matches: Array.from({ length: Math.min(storedMatches, 25) }, (_, i) =>
          match(i),
        ),
        total: storedMatches,
        total_analyzed: storedMatches,
        page: 1,
        page_size: 25,
      },
    };
  });
}

function renderHistory(): void {
  renderWithQueryClient(
    <MatchHistory puuid={PUUID} onSelectPlayer={vi.fn()} />,
  );
}

describe("Match History progressive loading", () => {
  beforeEach(() => {
    window.localStorage.clear();
    validatedGet.mockReset();
    validatedPost.mockReset();
  });

  it("renders stored matches and a loading row while the update is still fetching", async () => {
    mockHistory(3, "running");
    renderHistory();

    await waitFor(() =>
      expect(screen.getAllByText("Mordekaiser").length).toBeGreaterThan(0),
    );
    // The whole point of the ticket: the three stored rows are readable, not
    // replaced by a card-wide loading state.
    expect(screen.getByTestId("match-history-loading-row")).toBeTruthy();
    expect(screen.getByText("Loading more matches...")).toBeTruthy();
  });

  it("says the count is still loading instead of a range that keeps moving", async () => {
    mockHistory(3, "running");
    renderHistory();

    await waitFor(() =>
      expect(screen.getByText("Loading matches count...")).toBeTruthy(),
    );
    expect(screen.queryByText(/Showing 1 to/)).toBeNull();
  });

  it("shows the loading row as the only body row before the first match arrives", async () => {
    mockHistory(0, "running");
    renderHistory();

    await waitFor(() =>
      expect(screen.getByTestId("match-history-loading-row")).toBeTruthy(),
    );
    // "No matches" is a verdict, and the run that would produce the first one
    // has not finished.
    expect(screen.queryByText(/No ranked matches/i)).toBeNull();
    expect(screen.queryByText(/No matches found/i)).toBeNull();
  });

  it("returns to the final range and drops the loading row once the run ends", async () => {
    mockHistory(3, null);
    renderHistory();

    await waitFor(() =>
      expect(screen.getByText(/Showing 1 to 3 of 3 matches/)).toBeTruthy(),
    );
    expect(screen.queryByTestId("match-history-loading-row")).toBeNull();
  });

  it("does not expose a next page until a fetched record belongs on it", async () => {
    // Exactly one page's worth stored: page 2 would be empty, so it must not
    // be offered even though more records are still coming.
    mockHistory(25, "running");
    renderHistory();

    await waitFor(() =>
      expect(screen.getByTestId("match-history-loading-row")).toBeTruthy(),
    );
    expect(
      screen.queryByRole("button", { name: "2" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Next page" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("exposes the next page once fetched rows spill onto it", async () => {
    mockHistory(30, "running");
    renderHistory();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "2" })).toBeTruthy(),
    );
    expect(screen.queryByRole("button", { name: "3" })).toBeNull();
  });
});
