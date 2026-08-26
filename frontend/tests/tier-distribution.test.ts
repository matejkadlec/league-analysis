import { describe, expect, it } from "vitest";

import { tierShareRows } from "@/features/matchmaking/components/tier-distribution";

describe("tierShareRows", () => {
  it("normalizes each side to percent of its own player count", () => {
    // The regression: raw counts made every enemy bar longer (5 enemies vs
    // 4 allies per match) and the chart read as "enemies rank higher".
    const rows = tierShareRows(
      { GOLD: 10, PLATINUM: 30 },
      { GOLD: 15, PLATINUM: 45 },
    );

    expect(rows).toEqual([
      { tier: "Gold", Allies: 25, Enemies: 25, allyCount: 10, enemyCount: 15 },
      {
        tier: "Platinum",
        Allies: 75,
        Enemies: 75,
        allyCount: 30,
        enemyCount: 45,
      },
    ]);
  });

  it("keeps a one-sided tier and gives the empty side 0, never NaN", () => {
    const rows = tierShareRows({ SILVER: 4 }, {});

    expect(rows).toEqual([
      { tier: "Silver", Allies: 100, Enemies: 0, allyCount: 4, enemyCount: 0 },
    ]);
  });

  it("orders tiers ascending with the unranked bucket last", () => {
    const rows = tierShareRows(
      { UNRANKED: 1, GOLD: 1 },
      { IRON: 1, CHALLENGER: 1 },
    );

    expect(rows.map((row) => row.tier)).toEqual([
      "Iron",
      "Gold",
      "Challenger",
      "Unranked",
    ]);
  });
});
