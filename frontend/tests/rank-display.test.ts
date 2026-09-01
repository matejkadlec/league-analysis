import { describe, expect, it } from "vitest";

import { rankValueToDisplay } from "@/features/players";

// The scale itself is checked against the backend's own fixture table in
// rank-scale-alignment.test.ts; what is left here is rounding.
describe("rankValueToDisplay", () => {
  it("renders a fractional average inside the division that contains it", () => {
    // Averages are means, not stored entries, so they are rarely integers.
    // 1550.5 rounds to 1551 = GOLD (1200) + 351 -> division I, 51 LP.
    expect(rankValueToDisplay(1550.5).label).toBe("Gold I · 51 LP");
  });

  it("promotes a fraction that rounds across a boundary instead of 100 LP", () => {
    expect(rankValueToDisplay(1599.7).label).toBe("Platinum IV · 0 LP");
  });
});
