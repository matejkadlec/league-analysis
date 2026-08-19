import { describe, expect, it } from "vitest";

import { formatFractionAsPercent, winRateColors } from "@/lib/core/format";

describe("the shared win rate colours", () => {
  // One copy now serves the player card and both profile cards; these bands
  // used to exist in three files. Text and bar come from the same verdict,
  // so a green number can never sit over a red bar.
  it.each([
    [0.51, "text-green-500", "bg-green-500"],
    [0.509, "text-yellow-500", "bg-yellow-500"],
    [0.5, "text-yellow-500", "bg-yellow-500"],
    [0.491, "text-yellow-500", "bg-yellow-500"],
    [0.49, "text-rose-500", "bg-rose-500"],
    [0, "text-rose-500", "bg-rose-500"],
    [1, "text-green-500", "bg-green-500"],
  ])("draws a %s fraction in matching colours", (fraction, text, bar) => {
    expect(winRateColors(fraction)).toEqual({ text, bar });
  });
});

describe("the percent formatter", () => {
  it("formats a 0-1 fraction and only a fraction", () => {
    // The helper this replaced guessed its unit (`<= 1 ? * 100 : as-is`), so
    // a ranked player between 0 and 1 percent rendered as 100%. The unit is
    // now part of the contract: a sub-1% win rate is a sub-1% win rate.
    expect(formatFractionAsPercent(0.625)).toBe("62.5%");
    expect(formatFractionAsPercent(0.005)).toBe("0.5%");
    expect(formatFractionAsPercent(1)).toBe("100%");
  });

  it("drops a trailing zero rather than printing it", () => {
    expect(formatFractionAsPercent(0.5)).toBe("50%");
    expect(formatFractionAsPercent(0)).toBe("0%");
  });
});
