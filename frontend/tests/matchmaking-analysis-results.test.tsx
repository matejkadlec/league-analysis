// @vitest-environment jsdom

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithQueryClient } from "./support/render-support";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getLatestCompletedMatchmakingAnalysis, getMatchmakingAnalysisStatus } =
  vi.hoisted(() => ({
    getLatestCompletedMatchmakingAnalysis:
      vi.fn<
        typeof import("@/features/matchmaking/matchmaking-api").getLatestCompletedMatchmakingAnalysis
      >(),
    getMatchmakingAnalysisStatus:
      vi.fn<
        typeof import("@/features/matchmaking/matchmaking-api").getMatchmakingAnalysisStatus
      >(),
  }));

vi.mock("@/features/matchmaking/matchmaking-api", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/features/matchmaking/matchmaking-api")
  >()),
  getLatestCompletedMatchmakingAnalysis,
  getMatchmakingAnalysisStatus,
}));

import { MatchmakingAnalysisResults } from "@/features/matchmaking/components/matchmaking-analysis-results";
import type { ApiResponse } from "@/lib/core/http/api";
import type { MatchmakingAnalysisResponse } from "@/lib/core/schemas";

/** A local-time date, so the formatter's local getters have a known answer. */
const CREATED_AT = new Date(2026, 2, 4, 14, 7).toISOString();

function completed(
  results: {
    team_avg_winrate: number;
    enemy_avg_winrate: number;
    matches_analyzed: number;
  },
  createdAt: string = CREATED_AT,
): ApiResponse<MatchmakingAnalysisResponse> {
  return {
    success: true,
    data: {
      puuid: "puuid",
      status: "completed",
      progress: 10,
      total_puuids: 10,
      requests_saved: 0,
      created_at: createdAt,
      params: { match_count: 10, end_date: null },
      results,
    },
  };
}

const EVEN = {
  team_avg_winrate: 0.5,
  enemy_avg_winrate: 0.5,
  matches_analyzed: 910,
};

const showLatest = vi.fn<() => void>();

function renderResults(selectedCreatedAt: string | null = null) {
  return renderWithQueryClient(
    <MatchmakingAnalysisResults
      puuid="puuid"
      analyzedPlayerLabel="Faker"
      selectedCreatedAt={selectedCreatedAt}
      onShowLatest={showLatest}
    />,
  );
}

beforeEach(() => {
  getLatestCompletedMatchmakingAnalysis.mockReset();
  getMatchmakingAnalysisStatus.mockReset();
  showLatest.mockReset();
});


describe("the last matchmaking analysis result", () => {
  it("tells a player who has never run one apart from one that failed to load", async () => {
    // A 404 means "never ran one" and the query turns it into `null`, not an
    // error; both states share a card, so only its sentence separates them.
    getLatestCompletedMatchmakingAnalysis.mockResolvedValue({
      success: false,
      error: {
        status: 404,
        kind: "not-found",
        message: "No analysis has been run for this player.",
      },
    });
    const { queryClient } = renderResults();

    await waitFor(() =>
      expect(
        screen.getByText(/No completed analysis is available/),
      ).toBeTruthy(),
    );
    queryClient.clear();
  });

  it("says a real failure could not be loaded rather than claiming there is none", async () => {
    getLatestCompletedMatchmakingAnalysis.mockResolvedValue({
      success: false,
      error: {
        status: 500,
        kind: "service",
        message: "The service is unavailable.",
      },
    });
    const { queryClient } = renderResults();

    await waitFor(() =>
      expect(
        screen.getByText(/The latest result could not be loaded/),
      ).toBeTruthy(),
    );
    queryClient.clear();
  });

  it("does not show numbers from an analysis that has not finished", async () => {
    // A row exists but the run is unfinished: `splitRunOnLifecycle` keeps the
    // partial averages from reaching the card, since only `completed` owns them.
    getLatestCompletedMatchmakingAnalysis.mockResolvedValue({
      success: true,
      data: {
        puuid: "puuid",
        status: "in_progress",
        progress: 4,
        total_puuids: 10,
        requests_saved: 0,
        created_at: CREATED_AT,
        params: { match_count: 10, end_date: null },
      },
    });
    const { queryClient } = renderResults();

    await waitFor(() =>
      expect(
        screen.getByText(/No completed analysis is available/),
      ).toBeTruthy(),
    );
    expect(screen.queryByText(/90%/)).toBeNull();
    queryClient.clear();
  });

  it("calls a gap of exactly three points favourable, not fair", async () => {
    // The pair has to be 0.03 and 0, not 0.53 and 0.5: `0.53 - 0.5` is
    // 0.030000000000000027 and so never lands on the `>=` boundary.
    getLatestCompletedMatchmakingAnalysis.mockResolvedValue(
      completed({
        team_avg_winrate: 0.03,
        enemy_avg_winrate: 0,
        matches_analyzed: 910,
      }),
    );
    const { queryClient } = renderResults();

    await waitFor(() =>
      expect(screen.getByText(/teammates had higher average win/)).toBeTruthy(),
    );
    // Anchored on "by": a bare "3%" would also match a wrong 13% or 23%,
    // and the team's own 3% renders in the table as well.
    expect(
      screen.getByText(/teammates had higher average win/).textContent,
    ).toContain("by 3%");
    expect(screen.queryByText(/relatively fair/)).toBeNull();
    queryClient.clear();
  });

  it("colours the two rows against each other, not the same way", async () => {
    // The two cells carry mirror-image ternaries over one pair of booleans:
    // copy one into the other and both teams turn green on a favourable result.
    getLatestCompletedMatchmakingAnalysis.mockResolvedValue(
      completed({
        team_avg_winrate: 0.6,
        enemy_avg_winrate: 0.5,
        matches_analyzed: 910,
      }),
    );
    const { container, queryClient } = renderResults();

    await waitFor(() => expect(screen.getByText("60%")).toBeTruthy());

    const [team, enemy] = [
      ...container.querySelectorAll("td.text-right span"),
    ].map((cell) => cell.className);
    expect(team).toContain("green");
    expect(enemy).toContain("red");

    queryClient.clear();
  });

  it("calls a gap of exactly three points against the player unfavourable", async () => {
    // The mirror boundary needs its own exact pair: `0 - 0.03` is the same
    // double as `-0.03`, so `<=` narrowed to `<` shows up only here.
    getLatestCompletedMatchmakingAnalysis.mockResolvedValue(
      completed({
        team_avg_winrate: 0,
        enemy_avg_winrate: 0.03,
        matches_analyzed: 910,
      }),
    );
    const { queryClient } = renderResults();

    await waitFor(() =>
      expect(screen.getByText(/opponents had higher average win/)).toBeTruthy(),
    );
    expect(screen.queryByText(/relatively fair/)).toBeNull();
    queryClient.clear();
  });

  it("calls anything inside the band fair", async () => {
    getLatestCompletedMatchmakingAnalysis.mockResolvedValue(
      completed({
        team_avg_winrate: 0.5299,
        enemy_avg_winrate: 0.5,
        matches_analyzed: 910,
      }),
    );
    const { queryClient } = renderResults();

    await waitFor(() =>
      expect(screen.getByText(/relatively fair/)).toBeTruthy(),
    );
    expect(screen.queryByText(/teammates had higher/)).toBeNull();
    expect(screen.queryByText(/opponents had higher/)).toBeNull();
    queryClient.clear();
  });

  it("names the opponents when the gap runs the other way", async () => {
    // The percentage shown is `Math.abs`, so a leaked sign tells a player who
    // was outmatched that they were favoured.
    getLatestCompletedMatchmakingAnalysis.mockResolvedValue(
      completed({
        team_avg_winrate: 0.5,
        enemy_avg_winrate: 0.55,
        matches_analyzed: 910,
      }),
    );
    const { queryClient } = renderResults();

    await waitFor(() =>
      expect(screen.getByText(/opponents had higher average win/)).toBeTruthy(),
    );
    expect(screen.getByText("5%")).toBeTruthy();
    expect(screen.queryByText(/teammates had higher/)).toBeNull();
    // The three verdicts are independent conditions, not a cascade: dropping
    // `!isUnfavorable` from `isFair` renders two contradictions at once.
    expect(screen.queryByText(/relatively fair/)).toBeNull();
    queryClient.clear();
  });

  it("reports the stored count without rewriting it", async () => {
    // The basis is `10 + 90 * MATCHES_FOR_WINRATE`; migration 20260820_0017 moved
    // the stored rows, so the card shows what the database holds.
    getLatestCompletedMatchmakingAnalysis.mockResolvedValue(
      completed({
        team_avg_winrate: 0.5,
        enemy_avg_winrate: 0.5,
        matches_analyzed: 820,
      }),
    );
    const { queryClient } = renderResults();

    await waitFor(() =>
      expect(screen.getByText(/Based on 820 ranked matches/)).toBeTruthy(),
    );
    queryClient.clear();
  });

  it("reports any other count as it was stored", async () => {
    getLatestCompletedMatchmakingAnalysis.mockResolvedValue(
      completed({
        team_avg_winrate: 0.5,
        enemy_avg_winrate: 0.5,
        matches_analyzed: 455,
      }),
    );
    const { queryClient } = renderResults();

    await waitFor(() =>
      expect(screen.getByText(/Based on 455 ranked matches/)).toBeTruthy(),
    );
    queryClient.clear();
  });

  it("mounts none of the extension surfaces for a legacy run", async () => {
    getLatestCompletedMatchmakingAnalysis.mockResolvedValue(completed(EVEN));
    const { queryClient } = renderResults();

    await waitFor(() =>
      expect(screen.getByText(/Last 10 Matches/)).toBeTruthy(),
    );
    expect(screen.queryByLabelText("Match scope filter")).toBeNull();
    expect(screen.queryByText("Average Rank")).toBeNull();
    expect(screen.queryByText("Tier Distribution")).toBeNull();
    expect(screen.queryByText("Recent Form")).toBeNull();
    queryClient.clear();
  });

  it("hides Recent Form for a run whose per_match predates the metrics", async () => {
    // LGA-105 runs carry per_match but no performance fields; a table of
    // dashes would read as "these teams did nothing".
    getLatestCompletedMatchmakingAnalysis.mockResolvedValue(
      completed({
        ...EVEN,
        per_match: [
          { match_id: "m1", duo: true, team_avg: 0.5, enemy_avg: 0.5 },
        ],
      } as never),
    );
    const { queryClient } = renderResults();

    await waitFor(() =>
      expect(screen.getByLabelText("Match scope filter")).toBeTruthy(),
    );
    expect(screen.queryByText("Recent Form")).toBeNull();
    queryClient.clear();
  });

  it("renders Recent Form per side, dashing only the missing metric", async () => {
    getLatestCompletedMatchmakingAnalysis.mockResolvedValue(
      completed({
        ...EVEN,
        per_match: [
          {
            match_id: "m1",
            duo: false,
            team_avg: 0.5,
            enemy_avg: 0.5,
            team_kda: 2.5,
            enemy_kda: 3.1,
            team_kill_participation: 0.55,
            enemy_kill_participation: null,
            team_damage_share: 0.2,
            enemy_damage_share: 0.25,
          },
        ],
      } as never),
    );
    const { queryClient } = renderResults();

    await waitFor(() => expect(screen.getByText("Recent Form")).toBeTruthy());
    expect(screen.getByText("2.50")).toBeTruthy();
    expect(screen.getByText("3.10")).toBeTruthy();
    expect(screen.getByText("55%")).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.getByText("25%")).toBeTruthy();
    queryClient.clear();
  });

  it("mounts the scope filter, ranks, freshness and tiers for an extended run", async () => {
    getLatestCompletedMatchmakingAnalysis.mockResolvedValue(
      completed({
        ...EVEN,
        matches_requested: 10,
        spine_matches_found: 10,
        ally_avg_rank_value: 1575,
        enemy_avg_rank_value: 2120,
        ally_tier_counts: { GOLD: 20, UNRANKED: 2 },
        enemy_tier_counts: { EMERALD: 19, UNRANKED: 3 },
        per_match: [
          { match_id: "m1", duo: true, team_avg: 0.5, enemy_avg: 0.5 },
          { match_id: "m2", duo: false, team_avg: 0.5, enemy_avg: 0.5 },
        ],
        rank_freshness: { period_accurate: 78, current_day: 13 },
      } as never),
    );
    const { queryClient } = renderResults();

    await waitFor(() =>
      expect(screen.getByLabelText("Match scope filter")).toBeTruthy(),
    );
    expect(screen.getByText(/1 likely duo \/ 1 solo matches/)).toBeTruthy();
    // The shared-scale fixtures: 1575 is Gold I, 2120 Emerald III.
    expect(screen.getByText("Gold I · 75 LP")).toBeTruthy();
    expect(screen.getByText("Emerald III · 20 LP")).toBeTruthy();
    expect(
      screen.getByText(/Enemies average 5 divisions and 45 LP higher/),
    ).toBeTruthy();
    expect(screen.getByText(/78 ranks measured near/)).toBeTruthy();
    expect(screen.getByText("Tier Distribution")).toBeTruthy();
    queryClient.clear();
  });

  it("captions a partial backdated window honestly, never as latest", async () => {
    getLatestCompletedMatchmakingAnalysis.mockResolvedValue({
      success: true,
      data: {
        puuid: "puuid",
        status: "completed",
        progress: 30,
        total_puuids: 30,
        requests_saved: 0,
        created_at: CREATED_AT,
        params: { match_count: 30, end_date: "2026-07-26" },
        results: {
          ...EVEN,
          matches_requested: 30,
          spine_matches_found: 8,
        },
      },
    });
    const { queryClient } = renderResults();

    await waitFor(() =>
      expect(
        screen.getByText(/8 of 30 Matches through Jul 26, 2026/),
      ).toBeTruthy(),
    );
    expect(screen.queryByText(/Last 30 Matches/)).toBeNull();
    queryClient.clear();
  });

  it.each([
    [new Date(2026, 2, 4, 14, 7), "4.3.2026 2:07 PM"],
    // Midnight is the one `hours % 12` turns into 0, so without this fixture
    // the formatter's `|| 12` can be deleted unnoticed.
    [new Date(2026, 2, 4, 0, 5), "4.3.2026 12:05 AM"],
    // Noon is the only hour where `>= 12` and `> 12` disagree, so it is the
    // only fixture that pins the meridiem boundary.
    [new Date(2026, 2, 4, 12, 30), "4.3.2026 12:30 PM"],
    [new Date(2026, 2, 4, 23, 59), "4.3.2026 11:59 PM"],
  ])("writes %s as %s", async (createdAt, expected) => {
    // The three things a hand-rolled clock gets wrong: `07` not `7`, midnight
    // as 12 not 0, noon as PM not AM.
    getLatestCompletedMatchmakingAnalysis.mockResolvedValue(
      completed(EVEN, createdAt.toISOString()),
    );
    const { queryClient } = renderResults();

    await waitFor(() => expect(screen.getByText(expected)).toBeTruthy());
    queryClient.clear();
  });

  it("shows the run picked in the history card, not the newest one", async () => {
    // The two panels read different endpoints. Ignore the picked timestamp and
    // the card silently answers with the latest run instead of the chosen one.
    const PICKED = new Date(2026, 1, 9, 10, 0).toISOString();
    getLatestCompletedMatchmakingAnalysis.mockResolvedValue(
      completed({ ...EVEN, matches_analyzed: 910 }),
    );
    getMatchmakingAnalysisStatus.mockResolvedValue(
      completed(
        {
          team_avg_winrate: 0.44,
          enemy_avg_winrate: 0.54,
          matches_analyzed: 455,
        },
        PICKED,
      ),
    );
    const { queryClient } = renderResults(PICKED);

    await waitFor(() =>
      expect(screen.getByText(/Based on 455 ranked matches/)).toBeTruthy(),
    );
    expect(screen.getByText("Selected Analysis Result")).toBeTruthy();
    expect(screen.getByText("9.2.2026 10:00 AM")).toBeTruthy();
    expect(getMatchmakingAnalysisStatus.mock.calls[0]?.slice(0, 2)).toEqual([
      "puuid",
      PICKED,
    ]);
    expect(getLatestCompletedMatchmakingAnalysis).not.toHaveBeenCalled();
    queryClient.clear();
  });

  it("offers a way back to the latest run from a picked one", async () => {
    // Selection is the page's state, so without this control a viewer who
    // opened an old run has nothing on screen that returns them to the latest.
    const user = userEvent.setup();
    const PICKED = new Date(2026, 1, 9, 10, 0).toISOString();
    getMatchmakingAnalysisStatus.mockResolvedValue(completed(EVEN, PICKED));
    const { queryClient } = renderResults(PICKED);

    // The loading card carries a "Show latest" of its own, so waiting on that
    // text alone hands back a button the loaded card is about to replace.
    await screen.findByText(/Based on \d+ ranked matches/);

    // The state the control belongs to: an old run on screen is the only
    // thing there is to come back from.
    expect(screen.getByText("Selected Analysis Result")).toBeTruthy();
    await user.click(screen.getByText("Show latest"));

    expect(showLatest).toHaveBeenCalledTimes(1);
    queryClient.clear();
  });

  it("says a picked run is gone rather than claiming the player has none", async () => {
    // A run deleted in another tab answers 404. Reusing the never-analyzed
    // sentence would tell a player with a full history that they have none.
    const PICKED = new Date(2026, 1, 9, 10, 0).toISOString();
    getMatchmakingAnalysisStatus.mockResolvedValue({
      success: false,
      error: {
        status: 404,
        kind: "not-found",
        message: "No analysis found for this player.",
      },
    });
    const { queryClient } = renderResults(PICKED);

    await waitFor(() =>
      expect(screen.getByText(/no longer available/)).toBeTruthy(),
    );
    expect(screen.queryByText(/No completed analysis is available/)).toBeNull();
    queryClient.clear();
  });
});
