import { describe, expect, it } from "vitest";

import { rankValueToDisplay } from "@/features/players";

/**
 * Shared with the backend scale test (`test_matchmaking_ranks.py`): the same
 * (tier, division, LP) -> value quadruples must hold on both sides, or the
 * two implementations of the LP-equivalent scale drift apart silently. The
 * display column is this side's own inverse; everything at or above the
 * MASTER floor collapses to "Master+" because the value alone cannot tell
 * Master, Grandmaster and Challenger apart.
 */
const SCALE_FIXTURES: Array<[number, string, string]> = [
  [0, "IRON", "Iron IV"],
  [99, "IRON", "Iron IV"],
  [1040, "SILVER", "Silver II"],
  [1575, "GOLD", "Gold I"],
  [2120, "EMERALD", "Emerald III"],
  [2700, "DIAMOND", "Diamond I"],
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
    // 1550.5 = GOLD (1200) + 350.5 -> division I.
    expect(rankValueToDisplay(1550.5).label).toBe("Gold I");
  });
});
