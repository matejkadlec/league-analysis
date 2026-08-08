import { describe, expect, it } from "vitest";

import { PlayerLeagueSchema } from "@/lib/core/schemas";

const leagueSnapshot = {
  puuid: "sanitized-puuid",
  league_id: null,
  queue_type: "RANKED_SOLO_5x5",
  tier: "GOLD",
  rank: "II",
  league_points: 42,
  wins: 12,
  losses: 8,
  veteran: false,
  inactive: false,
  fresh_blood: true,
  hot_streak: false,
  created_at: "2026-08-08T17:00:00Z",
  win_rate: 60,
  total_games: 20,
  display_rank: "Gold II",
};

describe("PlayerLeagueSchema", () => {
  it("accepts a saved league snapshot when Riot omitted leagueId", () => {
    const parsed = PlayerLeagueSchema.parse(leagueSnapshot);

    expect(parsed.league_id).toBeNull();
    expect(parsed.display_rank).toBe("Gold II");
  });
});
