// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PlayerCardWinRate } from "@/features/players/components/player-card-win-rate";
import type {
  MatchStatsResponse,
  PlayerLeague,
} from "@/lib/core/schemas";

// Deliberately disagrees with the stats fixture (0.6) so an assertion can
// tell which source the card rendered.
const league: PlayerLeague = {
  puuid: "p-1",
  queue_type: "RANKED_SOLO_5x5",
  tier: "GOLD",
  rank: "II",
  league_points: 42,
  wins: 60,
  losses: 40,
  created_at: "2026-08-19T08:00:00Z",
  win_rate: 0.555,
  total_games: 100,
  display_rank: "Gold II",
};

const stats: MatchStatsResponse = {
  puuid: "p-1",
  total_matches: 25,
  wins: 15,
  losses: 10,
  win_rate: 0.6,
  avg_kills: 5,
  avg_deaths: 4,
  avg_assists: 7,
  avg_kda: 3,
  avg_cs: 180,
  avg_vision_score: 22,
};

describe("the player card's win rate block", () => {
  it("speaks for the ranked row when there is one", () => {
    render(<PlayerCardWinRate league={league} stats={stats} />);

    // The league's own figures, not the match-stats averages beside them.
    expect(screen.getByText("55.5%")).toBeTruthy();
    expect(screen.getByText("60W")).toBeTruthy();
    expect(screen.getByText("40L")).toBeTruthy();
    // A ranked player is not labelled unranked.
    expect(screen.queryByText("(unranked)")).toBeNull();
  });

  it("falls back to match stats and says so when there is no league row", () => {
    render(
      <PlayerCardWinRate league={null} leagueFailed={false} stats={stats} />,
    );

    expect(screen.getByText("(unranked)")).toBeTruthy();
    expect(screen.getByText("60%")).toBeTruthy();
    expect(screen.getByText("15W")).toBeTruthy();
    expect(screen.getByText("10L")).toBeTruthy();
  });

  it("claims nothing when the league lookup failed or no matches exist", () => {
    // "(unranked)" is a claim a failed request cannot support, and a player
    // with no matches supports no rate at all. Both must render nothing.
    const failed = render(
      <PlayerCardWinRate league={null} leagueFailed stats={stats} />,
    );
    expect(failed.container.textContent).toBe("");

    cleanup();

    const untouched = render(
      <PlayerCardWinRate
        league={null}
        leagueFailed={false}
        stats={{ ...stats, total_matches: 0 }}
      />,
    );
    expect(untouched.container.textContent).toBe("");
  });

  it("colours the verdict through the shared thresholds", () => {
    // The number and its colour come from the same verdict call, so a green
    // percentage can never sit over a rose-coloured reading.
    render(<PlayerCardWinRate league={{ ...league, win_rate: 0.51 }} stats={null} />);
    expect(screen.getByText("51%").className).toContain("text-green-500");

    cleanup();

    render(
      <PlayerCardWinRate league={{ ...league, win_rate: 0.49 }} stats={null} />,
    );
    expect(screen.getByText("49%").className).toContain("text-rose-500");
  });
});
