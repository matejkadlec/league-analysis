import { describe, expect, it } from "vitest";

import { scopeAggregates } from "@/features/matchmaking/scope-aggregates";
import type { MatchmakingPerMatch } from "@/lib/core/schemas";

const PER_MATCH: MatchmakingPerMatch[] = [
  { match_id: "m1", duo: true, team_avg: 0.4, enemy_avg: 0.6 },
  { match_id: "m2", duo: true, team_avg: 0.6, enemy_avg: 0.5 },
  { match_id: "m3", duo: false, team_avg: 0.5, enemy_avg: 0.5 },
];

describe("scopeAggregates", () => {
  it("averages only the matches inside the requested scope", () => {
    expect(scopeAggregates(PER_MATCH, "duo")).toEqual({
      teamAvg: 0.5,
      enemyAvg: 0.55,
      matchCount: 2,
    });
    expect(scopeAggregates(PER_MATCH, "solo")).toEqual({
      teamAvg: 0.5,
      enemyAvg: 0.5,
      matchCount: 1,
    });
  });

  it("returns null for an empty scope instead of producing NaN", () => {
    const allSolo = PER_MATCH.map((m) => ({ ...m, duo: false }));

    expect(scopeAggregates(allSolo, "duo")).toBeNull();
    expect(scopeAggregates([], "solo")).toBeNull();
  });
});
