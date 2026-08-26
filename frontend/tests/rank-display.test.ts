import { describe, expect, it } from "vitest";

import { rankValueToDisplay } from "@/features/players";

/**
 * Shared with the backend scale test (`test_matchmaking_ranks.py`): the same
 * fixtures must hold on both sides, or the two scale implementations drift.
 * Everything at or above the MASTER floor collapses to "Master+".
 */
const SCALE_FIXTURES: Array<[number, string, string]> = [
  [0, "IRON", "Iron IV · 0 LP"],
  [99, "IRON", "Iron IV · 99 LP"],
  [1040, "SILVER", "Silver II · 40 LP"],
  [1575, "GOLD", "Gold I · 75 LP"],
  [2120, "EMERALD", "Emerald III · 20 LP"],
  [2700, "DIAMOND", "Diamond I · 0 LP"],
  [2800, "MASTER", "Master+ 0 LP"],
  [3050, "MASTER", "Master+ 250 LP"],
  [4000, "MASTER", "Master+ 1200 LP"],
];

describe("rankValueToDisplay", () => {
  it.each(SCALE_FIXTURES)("maps %d to %s / %s", (value, tier, label) => {
    expect(rankValueToDisplay(value)).toEqual({ tier, label });
  });

  it("renders a fractional average inside the division that contains it", () => {
    // Averages are means, not stored entries, so they are rarely integers.
    // 1550.5 rounds to 1551 = GOLD (1200) + 351 -> division I, 51 LP.
    expect(rankValueToDisplay(1550.5).label).toBe("Gold I · 51 LP");
  });

  it("promotes a fraction that rounds across a boundary instead of 100 LP", () => {
    expect(rankValueToDisplay(1599.7).label).toBe("Platinum IV · 0 LP");
  });
});
