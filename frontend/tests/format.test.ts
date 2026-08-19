import { describe, expect, it } from "vitest";

import {
  formatFractionAsPercent,
  winRateBarColor,
  winRateTextColor,
} from "@/lib/core/format";

describe("the shared win rate colours", () => {
  // One copy now serves the player card and both profile cards; these bands
  // used to exist in three files, so this suite carries the threshold pins
  // that previously lived in player-card-format.test.ts. The two helpers are
  // read off the same number, one for a figure and one for the bar under it,
  // so a threshold that drifts between them shows a green number over a red
  // bar.
  it.each([
    [0.51, "text-green-500", "bg-green-500"],
    [0.5, "text-yellow-500", "bg-yellow-500"],
    [0.491, "text-yellow-500", "bg-yellow-500"],
    [0.49, "text-rose-500", "bg-rose-500"],
    [0, "text-rose-500", "bg-rose-500"],
    [1, "text-green-500", "bg-green-500"],
  ])("draws a %s fraction in matching colours", (fraction, text, bar) => {
    expect(winRateTextColor(fraction)).toBe(text);
    expect(winRateBarColor(fraction)).toBe(bar);
  });

  it("treats 51% as good and 49% as bad, not the other way round", () => {
    // Both boundaries are inclusive on one side only, and the band between
    // them is deliberately narrow. Moving either edge by one re-colours every
    // player sitting on it.
    expect(winRateTextColor(0.51)).toBe("text-green-500");
    expect(winRateTextColor(0.509)).toBe("text-yellow-500");
    expect(winRateTextColor(0.49)).toBe("text-rose-500");
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
