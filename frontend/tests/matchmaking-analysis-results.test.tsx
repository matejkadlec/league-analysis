// @vitest-environment jsdom

import { screen, waitFor } from "@testing-library/react";

import { renderWithQueryClient } from "./render-support";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getLatestCompletedMatchmakingAnalysis } = vi.hoisted(() => ({
  getLatestCompletedMatchmakingAnalysis: vi.fn(),
}));

vi.mock("@/features/matchmaking/matchmaking-api", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/features/matchmaking/matchmaking-api")
  >()),
  getLatestCompletedMatchmakingAnalysis,
}));

import { MatchmakingAnalysisResults } from "@/features/matchmaking/components/matchmaking-analysis-results";

/** A local-time date, so the formatter's local getters have a known answer. */
const CREATED_AT = new Date(2026, 2, 4, 14, 7).toISOString();

function completed(
  results: {
    team_avg_winrate: number;
    enemy_avg_winrate: number;
    matches_analyzed: number;
  },
  createdAt: string = CREATED_AT,
) {
  return {
    success: true,
    data: {
      id: 1,
      puuid: "puuid",
      status: "completed",
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

function renderResults() {
  return renderWithQueryClient(
    <MatchmakingAnalysisResults puuid="puuid" analyzedPlayerLabel="Faker" />,
  );
}

beforeEach(() => {
  getLatestCompletedMatchmakingAnalysis.mockReset();
});


describe("the last matchmaking analysis result", () => {
  it("tells a player who has never run one apart from one that failed to load", async () => {
    // The endpoint answers 404 when this player has never run an analysis,
    // which the query turns into `null` rather than an error. Both states
    // render the same card, so only the sentence inside it tells them apart.
    getLatestCompletedMatchmakingAnalysis.mockResolvedValue({
      success: false,
      error: { status: 404, kind: "not_found" },
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
      error: { status: 500, kind: "server" },
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
    // A row exists and carries `results`, but the run is still going, so the
    // averages in it are partial. Rendering them looks like a verdict.
    getLatestCompletedMatchmakingAnalysis.mockResolvedValue({
      success: true,
      data: {
        id: 1,
        puuid: "puuid",
        status: "running",
        created_at: CREATED_AT,
        params: { match_count: 10, end_date: null },
        results: {
          team_avg_winrate: 0.9,
          enemy_avg_winrate: 0.1,
          matches_analyzed: 910,
        },
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
    // The card says "within 3%", so 3.0 falls outside it. The pair has to be
    // 0.03 and 0, not 0.53 and 0.5: `0.53 - 0.5` is 0.030000000000000027 and was
    // never on the boundary, so that draft passed with `>=` mutated to `>`.
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
    // The two cells carry mirror-image ternaries over the same pair of
    // booleans. Copy one into the other and both teams turn green on a
    // favourable result, quietly losing the only signal in the table.
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
    // The mirror of the favourable boundary, and it needs its own exact pair
    // for the same floating-point reason: `0 - 0.03` is the same double as
    // `-0.03`. Without it, `<=` can be narrowed to `<` unnoticed.
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
    // The two directions are separate branches over the same number, and the
    // percentage shown is `Math.abs`, so a sign that leaks tells a player who
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
    // The three verdicts are three independent conditions rather than one
    // cascade, so nothing structural stops two of them rendering at once:
    // dropping `!isUnfavorable` from `isFair` prints both contradictions.
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
        id: 1,
        puuid: "puuid",
        status: "completed",
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
    // Midnight is the one `hours % 12` turns into 0, which is what the
    // `|| 12` in the shared formatter exists for. Without a midnight fixture
    // that expression can be deleted and every other hour still reads right.
    [new Date(2026, 2, 4, 0, 5), "4.3.2026 12:05 AM"],
    // Noon is the only hour where `>= 12` and `> 12` disagree, so it is the
    // only fixture that pins the meridiem boundary.
    [new Date(2026, 2, 4, 12, 30), "4.3.2026 12:30 PM"],
    [new Date(2026, 2, 4, 23, 59), "4.3.2026 11:59 PM"],
  ])("writes %s as %s", async (createdAt, expected) => {
    // These fixtures pin the three things every hand-rolled clock gets wrong:
    // `07` minutes rather than `7`, midnight reading as 12 rather than 0, and
    // noon being PM rather than AM.
    getLatestCompletedMatchmakingAnalysis.mockResolvedValue(
      completed(EVEN, createdAt.toISOString()),
    );
    const { queryClient } = renderResults();

    await waitFor(() => expect(screen.getByText(expected)).toBeTruthy());
    queryClient.clear();
  });
});
