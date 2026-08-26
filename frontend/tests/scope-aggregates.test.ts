import { describe, expect, it } from "vitest";

import {
  effectiveScope,
  scopeAggregates,
} from "@/features/matchmaking/scope-aggregates";
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

describe("effectiveScope", () => {
  const some = { teamAvg: 0.5, enemyAvg: 0.5, matchCount: 3 };

  it("keeps a selection whose aggregates exist", () => {
    expect(effectiveScope("duo", null, some)).toBe("duo");
    expect(effectiveScope("solo", some, null)).toBe("solo");
  });

  it("snaps back to all when the selected slice is gone", () => {
    // The regression: DuoQ stays selected after a player switch or a new
    // no-duo run, and the card would label All-scope figures as duo-scoped.
    expect(effectiveScope("duo", some, null)).toBe("all");
    expect(effectiveScope("solo", null, some)).toBe("all");
    expect(effectiveScope("all", some, some)).toBe("all");
  });
});
