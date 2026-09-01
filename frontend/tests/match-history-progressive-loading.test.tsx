// @vitest-environment jsdom

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithQueryClient } from "./support/render-support";

type Api = typeof import("@/lib/core/http/api");
type AppToast = typeof import("@/lib/core/hooks").appToast;
type AppRouter = ReturnType<typeof import("next/navigation").useRouter>;

const { validatedGet, validatedPost } = vi.hoisted(() => ({
  validatedGet: vi.fn<Api["validatedGet"]>(),
  validatedPost: vi.fn<Api["validatedPost"]>(),
}));

vi.mock("@/lib/core/http/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/http/api")>()),
  validatedGet,
  validatedPost,
}));

vi.mock("@/lib/core/hooks", () => ({
  useToast: () => ({
    error: vi.fn<AppToast["error"]>(),
    info: vi.fn<AppToast["info"]>(),
    warning: vi.fn<AppToast["warning"]>(),
    success: vi.fn<AppToast["success"]>(),
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn<AppRouter["refresh"]>() }),
}));

vi.mock("@/lib/core/riot/data-dragon-context", () => ({
  useDDragonVersion: () => "16.1.1",
}));

vi.mock("@/lib/core/hooks/use-relative-time", () => ({
  useRelativeTime: () => "just now",
}));

import type { ComponentProps } from "react";

import { MatchHistory } from "@/features/matches/components/match-history";
import { installMemoryLocalStorage } from "./support/test-browser-storage";

type SelectPlayer = ComponentProps<typeof MatchHistory>["onSelectPlayer"];

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
function mockHistory(
  storedMatches: number,
  runStatus: string | null,
  matchExecutionId: number | null = null,
): void {
  const run =
    runStatus === null
      ? null
      : {
          id: 7,
          puuid: PUUID,
          status: runStatus,
          match_execution_id: matchExecutionId,
          ...RUN_TIMESTAMPS,
        };
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
    <MatchHistory puuid={PUUID} onSelectPlayer={vi.fn<SelectPlayer>()} />,
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
    expect(screen.queryByRole("button", { name: "2" })).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Next page" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("stops claiming more matches once the match half of the run is done", async () => {
    // Still `running`, but `match_execution_id` is stamped between the Match
    // Fetcher and the Player Updater, and the profile half writes no matches.
    mockHistory(3, "running", 41);
    renderHistory();

    await waitFor(() =>
      expect(screen.getByText(/Showing 1 to 3 of 3 matches/)).toBeTruthy(),
    );
    expect(screen.queryByTestId("match-history-loading-row")).toBeNull();
  });

  it("re-reads the list once a run that stopped early settles", async () => {
    // A rate-limited run still stored rows, and the 2s poll ends the moment
    // the status leaves `running`, so its last tick's writes stay invisible.
    mockHistory(3, "rate_limited");
    renderHistory();

    const detailedCalls = () =>
      validatedGet.mock.calls.filter((call) =>
        String(call[1]).includes("/detailed"),
      ).length;

    await waitFor(() => expect(detailedCalls()).toBeGreaterThan(1));
  });

  it("keeps the fetched rows when a poll of the list fails", async () => {
    // The 2s poll only exists while rows are arriving, so an error card here
    // throws away readable matches over a blip.
    mockHistory(3, "running");
    renderHistory();
    await waitFor(() =>
      expect(screen.getAllByText("Mordekaiser").length).toBeGreaterThan(0),
    );

    // Only the list fails: the run keeps reporting itself, so the failure
    // lands while the card still believes more rows are coming.
    const stillRunning = {
      id: 7,
      puuid: PUUID,
      status: "running",
      match_execution_id: null,
      ...RUN_TIMESTAMPS,
    };
    validatedGet.mockImplementation(async (_schema: unknown, path: string) => {
      if (path.includes("/detailed")) {
        throw Object.assign(new Error("offline"), { isAxiosError: true });
      }
      if (path.includes("/sync")) {
        return { success: true, data: stillRunning };
      }
      return {
        success: true,
        data: {
          puuid: PUUID,
          total_matches: 3,
          wins: 3,
          losses: 0,
          win_rate: 1,
        },
      };
    });

    await waitFor(() =>
      expect(screen.getByTestId("match-history-load-failed-row")).toBeTruthy(),
    );
    expect(screen.getAllByText("Mordekaiser").length).toBeGreaterThan(0);
    // The spinner promised progress; the poll behind it is dead.
    expect(screen.queryByTestId("match-history-loading-row")).toBeNull();
  });

  it("still shows the error card when the failure left nothing to read", async () => {
    validatedGet.mockImplementation(async (_schema: unknown, path: string) => {
      if (path.includes("/detailed")) {
        throw Object.assign(new Error("offline"), { isAxiosError: true });
      }
      if (path.endsWith("/sync/active")) return { success: true, data: null };
      return { success: true, data: null };
    });
    renderHistory();

    await waitFor(() =>
      expect(
        screen.getByText(/Unable to reach the League Analysis/),
      ).toBeTruthy(),
    );
  });

  it("does not call an empty list a verdict when the request failed", async () => {
    // "No matches found" would be a conclusion drawn from a request that
    // never answered, and this row is the only report the query has.
    mockHistory(0, "running");
    renderHistory();
    await waitFor(() =>
      expect(screen.getByTestId("match-history-loading-row")).toBeTruthy(),
    );

    const stillRunning = {
      id: 7,
      puuid: PUUID,
      status: "running",
      match_execution_id: null,
      ...RUN_TIMESTAMPS,
    };
    validatedGet.mockImplementation(async (_schema: unknown, path: string) => {
      if (path.includes("/detailed")) {
        throw Object.assign(new Error("offline"), { isAxiosError: true });
      }
      if (path.includes("/sync")) {
        return { success: true, data: stillRunning };
      }
      return {
        success: true,
        data: {
          puuid: PUUID,
          total_matches: 0,
          wins: 0,
          losses: 0,
          win_rate: 0,
        },
      };
    });

    await waitFor(() =>
      expect(screen.getByTestId("match-history-load-failed-row")).toBeTruthy(),
    );
    expect(screen.queryByText(/No matches found/i)).toBeNull();
  });

  it("reports a failed page change instead of leaving the old page up", async () => {
    // Placeholder data keeps the old rows on screen and the query is opted out
    // of the global toast, so without this nothing says the change failed.
    mockHistory(30, null);
    renderHistory();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "2" })).toBeTruthy(),
    );

    validatedGet.mockImplementation(async (_schema: unknown, path: string) => {
      if (path.includes("/detailed")) {
        throw Object.assign(new Error("offline"), { isAxiosError: true });
      }
      if (path.includes("/sync")) return { success: true, data: null };
      return {
        success: true,
        data: {
          puuid: PUUID,
          total_matches: 30,
          wins: 30,
          losses: 0,
          win_rate: 1,
        },
      };
    });
    await userEvent.click(screen.getByRole("button", { name: "2" }));

    // The failed page-2 fetch carries no data, so the card must report rather
    // than quietly return to page 1 as though nothing was asked for.
    await waitFor(() =>
      expect(
        screen.getByText(/Unable to reach the League Analysis/),
      ).toBeTruthy(),
    );
    expect(screen.queryByText(/Showing 1 to 25 of 30/)).toBeNull();
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
