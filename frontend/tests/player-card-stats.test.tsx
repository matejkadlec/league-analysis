// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PlayerCardStats } from "@/features/players/components/player-card-stats";
import type { MatchStatsResponse, Player } from "@/lib/core/schemas";

function player(overrides: Partial<Player> = {}): Player {
  return {
    puuid: "p-1",
    game_name: "Hide on bush",
    tag_line: "KR1",
    platform: "eun1",
    summoner_level: 512,
    profile_icon_id: 123,
    is_tracked: false,
    analyzed_matches: 0,
    total_matches: 0,
    profile_synced_at: "2026-08-19T08:00:00Z",
    league_synced_at: "2026-08-19T08:00:00Z",
    match_synced_at: "2026-08-19T08:00:00Z",
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-19T08:00:00Z",
    ...overrides,
  };
}

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

describe("the player card's stats block", () => {
  it("says Never about a player nothing has touched yet", () => {
    render(
      <PlayerCardStats
        player={player({
          last_matchmaking_analysis: null,
          match_synced_at: null,
        })}
        stats={null}
      />,
    );

    // Two "Never"s: one per date line. Without the guard a null renders as
    // the epoch, claiming the player was analysed in 1970.
    expect(screen.getAllByText("Never")).toHaveLength(2);
    // And no averages follow: there is nothing to average.
    expect(screen.queryByText("Avg Kills")).toBeNull();
  });

  it("dates both lines on the card's UTC clock", () => {
    render(
      <PlayerCardStats
        player={player({
          last_matchmaking_analysis: "2026-03-04T23:30:00Z",
          match_synced_at: "2026-03-05T00:30:00Z",
        })}
        stats={stats}
      />,
    );

    expect(screen.getByText("Mar 4, 2026, 11:30 PM")).toBeTruthy();
    expect(screen.getByText("Mar 5, 2026, 12:30 AM")).toBeTruthy();
  });

  it("averages a played history at the precision each figure claims", () => {
    const { rerender } = render(
      <PlayerCardStats player={player()} stats={stats} />,
    );

    // Kills/deaths/assists and the KDA ratio carry a decimal; CS and vision
    // are whole-count averages.
    expect(screen.getByText("5.0")).toBeTruthy();
    expect(screen.getByText("4.0")).toBeTruthy();
    expect(screen.getByText("7.0")).toBeTruthy();
    expect(screen.getByText("3.00")).toBeTruthy();
    expect(screen.getByText("180")).toBeTruthy();
    expect(screen.getByText("22")).toBeTruthy();
    expect(screen.getByText("Avg Vision")).toBeTruthy();

    // No matches played: the averages disappear, the date lines stay.
    rerender(
      <PlayerCardStats
        player={player()}
        stats={{ ...stats, total_matches: 0 }}
      />,
    );
    expect(screen.queryByText("Avg Kills")).toBeNull();
    expect(screen.getByText("Match History Updated")).toBeTruthy();

    cleanup();
    render(<PlayerCardStats player={player()} stats={undefined} />);
    expect(screen.queryByText("Avg Kills")).toBeNull();
  });
});
