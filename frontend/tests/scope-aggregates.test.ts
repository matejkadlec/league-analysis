import { describe, expect, it } from "vitest";

import {
  effectiveScope,
  performanceAggregates,
  scopeAggregates,
  trimmedMean,
} from "@/features/matchmaking/scope-aggregates";
import {
  MatchmakingPerMatchSchema,
  type MatchmakingPerMatch,
} from "@/lib/core/schemas";

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

/**
 * Duplicated as TRIM_FIXTURES in the backend lifecycle test; both copies must
 * stay identical or the stored All-scope figure and the client's slices drift.
 * The n=5 fixture is asymmetric so trimming below ten values fails it.
 */
const TRIM_FIXTURES: Array<[number[], number]> = [
  [[0.0, 0.4, 0.45, 0.5, 0.5, 0.5, 0.55, 0.55, 0.6, 1.0], 0.50625],
  [[0.0, 0.5, 0.5, 0.5, 0.9], 0.48],
];

describe("trimmedMean", () => {
  it.each(TRIM_FIXTURES)("averages %j to %d", (values, expected) => {
    expect(trimmedMean(values)).toBeCloseTo(expected, 10);
  });

  it("trims inside scopeAggregates once a scope holds ten matches", () => {
    const perMatch = TRIM_FIXTURES[0]![0].map((wr, i) => ({
      match_id: `m${i}`,
      duo: true,
      team_avg: wr,
      enemy_avg: 0.5,
    }));

    expect(scopeAggregates(perMatch, "duo")?.teamAvg).toBeCloseTo(0.50625, 10);
  });
});

describe("MatchmakingPerMatchSchema", () => {
  it("parses an LGA-105 entry with the performance keys absent", () => {
    // Rejecting absent keys would blank the whole results card for every
    // run stored before the performance fields existed.
    const parsed = MatchmakingPerMatchSchema.parse({
      match_id: "m1",
      duo: true,
      team_avg: 0.5,
      enemy_avg: 0.5,
    });

    expect(parsed.team_kda).toBeUndefined();
    expect(parsed.enemy_damage_share).toBeUndefined();
  });

  it("parses a new entry whose metrics are explicit nulls", () => {
    const parsed = MatchmakingPerMatchSchema.parse({
      match_id: "m1",
      duo: false,
      team_avg: 0.5,
      enemy_avg: 0.5,
      team_kda: 2.5,
      enemy_kda: null,
      team_kill_participation: null,
      enemy_kill_participation: null,
      team_damage_share: null,
      enemy_damage_share: null,
    });

    expect(parsed.team_kda).toBe(2.5);
    expect(parsed.enemy_kda).toBeNull();
  });
});

describe("performanceAggregates", () => {
  const RICH = {
    match_id: "m1",
    duo: true,
    team_avg: 0.5,
    enemy_avg: 0.5,
    team_kda: 3.0,
    enemy_kda: 2.0,
    team_kill_participation: 0.6,
    enemy_kill_participation: 0.5,
    team_damage_share: 0.2,
    enemy_damage_share: 0.21,
  };
  // A run stored while some players' games lacked the ratio columns: the
  // match still carries KDA, and null must not drag anything to NaN.
  const SPARSE = {
    match_id: "m2",
    duo: false,
    team_avg: 0.5,
    enemy_avg: 0.5,
    team_kda: 1.0,
    enemy_kda: null,
    team_kill_participation: null,
    enemy_kill_participation: null,
    team_damage_share: null,
    enemy_damage_share: null,
  };

  it("averages each metric over only the matches that carry it", () => {
    const all = performanceAggregates([RICH, SPARSE], "all");

    expect(all?.team).toEqual({
      kda: 2.0,
      killParticipation: 0.6,
      damageShare: 0.2,
    });
    expect(all?.enemy).toEqual({
      kda: 2.0,
      killParticipation: 0.5,
      damageShare: 0.21,
    });
  });

  it("scopes to the duo flag like the winrate aggregates do", () => {
    expect(performanceAggregates([RICH, SPARSE], "solo")?.team.kda).toBe(1.0);
    expect(performanceAggregates([RICH, SPARSE], "duo")?.team.kda).toBe(3.0);
  });

  it("returns null for a legacy run rather than a table of dashes", () => {
    const preExtension = [
      { match_id: "m1", duo: true, team_avg: 0.5, enemy_avg: 0.5 },
    ];

    expect(performanceAggregates(preExtension, "all")).toBeNull();
    expect(performanceAggregates([], "all")).toBeNull();
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
