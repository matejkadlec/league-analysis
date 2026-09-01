import { describe, expect, it } from "vitest";

import {
  GAP_FAIRNESS_THRESHOLD,
  gapVerdict,
} from "@/features/matchmaking/gap-verdict";

/**
 * Two surfaces read the same gap with different thresholds on purpose: the
 * results card leaves a gap under three points grey, the table colours all.
 */
describe("gapVerdict", () => {
  it("calls a gap inside the fairness band fair", () => {
    expect(gapVerdict(0.029, GAP_FAIRNESS_THRESHOLD).verdict).toBe("fair");
    expect(gapVerdict(-0.029, GAP_FAIRNESS_THRESHOLD).verdict).toBe("fair");
    expect(gapVerdict(0.029, GAP_FAIRNESS_THRESHOLD).ally).toBe("");
  });

  it("includes the threshold itself in the verdict", () => {
    expect(gapVerdict(0.03, GAP_FAIRNESS_THRESHOLD).verdict).toBe("favorable");
    expect(gapVerdict(-0.03, GAP_FAIRNESS_THRESHOLD).verdict).toBe(
      "unfavorable",
    );
  });

  it("gives the two teams opposite colours", () => {
    const favorable = gapVerdict(0.1, GAP_FAIRNESS_THRESHOLD);
    expect(favorable.ally).toContain("green");
    expect(favorable.enemy).toContain("red");

    const unfavorable = gapVerdict(-0.1, GAP_FAIRNESS_THRESHOLD);
    expect(unfavorable.ally).toContain("red");
    expect(unfavorable.enemy).toContain("green");
  });

  it("colours every gap at a zero threshold, the history table's reading", () => {
    expect(gapVerdict(0.0001, 0).verdict).toBe("favorable");
    expect(gapVerdict(-0.0001, 0).verdict).toBe("unfavorable");
    // Exactly zero reads as unfavorable rather than grey, which is what the
    // history table did before this function existed.
    expect(gapVerdict(0, 0).ally).toContain("red");
  });
});
