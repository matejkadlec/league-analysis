import { describe, expect, it } from "vitest";

import {
  GAP_FAIRNESS_THRESHOLD,
  formatSignedGap,
  gapVerdict,
} from "@/features/matchmaking/gap-verdict";

/**
 * One reading of a win-rate gap for both surfaces that show it, the result
 * cards and the history list (LGA-135): the same fairness band, the same
 * colour, and a symbol that carries the meaning without the colour.
 */
describe("gapVerdict", () => {
  it("calls a gap inside the fairness band fair, uncoloured", () => {
    for (const gap of [0, 0.029, -0.029]) {
      expect(gapVerdict(gap)).toMatchObject({
        verdict: "fair",
        tone: "",
        symbol: "≈",
      });
    }
  });

  it("includes the threshold itself in the verdict", () => {
    expect(gapVerdict(GAP_FAIRNESS_THRESHOLD).verdict).toBe("favorable");
    expect(gapVerdict(-GAP_FAIRNESS_THRESHOLD).verdict).toBe("unfavorable");
  });

  it("colours a gap by what it means for the analyzed player", () => {
    // A higher enemy win rate is bad news, so it is never drawn in the
    // colour that reads as good -- the defect LGA-135 reported.
    const favorable = gapVerdict(0.1);
    const unfavorable = gapVerdict(-0.1);
    expect(favorable.tone).toContain("green");
    expect(unfavorable.tone).toContain("red");
    expect(favorable.tone).not.toBe(unfavorable.tone);
  });

  it("gives every reading its own symbol, so colour is never the only cue", () => {
    const symbols = [0.1, 0, -0.1].map((gap) => gapVerdict(gap).symbol);
    expect(new Set(symbols).size).toBe(3);
  });
});

describe("formatSignedGap", () => {
  it("signs a gap by its direction", () => {
    expect(formatSignedGap(0.062)).toMatch(/^\+/);
    expect(formatSignedGap(-0.062)).toMatch(/^−/);
    expect(formatSignedGap(0.062).slice(1)).toBe(
      formatSignedGap(-0.062).slice(1),
    );
  });

  it("leaves a gap that rounds to nothing unsigned", () => {
    expect(formatSignedGap(0)).not.toMatch(/^[+−]/);
    expect(formatSignedGap(0.00001)).not.toMatch(/^[+−]/);
  });
});
