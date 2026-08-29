// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { SmurfBoostExplanationCard } from "@/features/smurf-boost/components/smurf-boost-explanation-card";
import {
  BAND_LABELS,
  DISCLAIMER,
  FAMILY_DESCRIPTIONS,
  FAMILY_TITLES,
} from "@/features/smurf-boost/smurf-boost-vocabulary";

/**
 * Nothing executed this card: `rank-manipulation-page.test.tsx` stubs the
 * whole smurf-boost module out. It takes no props, so the assertions are on
 * the diagram and on the vocabulary it must not restate in its own words.
 */

afterEach(() => {
  cleanup();
});

describe("SmurfBoostExplanationCard", () => {
  it("draws two windows of the same player, the recent one smaller", () => {
    // The diagram is the explanation: eight muted dots for the earlier window
    // and five primary ones for the recent. Equal counts, or one colour for
    // both, would read as two players compared against each other.
    const { container } = render(<SmurfBoostExplanationCard />);

    const earlier = container.querySelectorAll(".bg-muted-foreground\\/40");
    const recent = container.querySelectorAll(".bg-primary");

    expect(earlier).toHaveLength(8);
    expect(recent).toHaveLength(5);
    expect(
      screen.getByText(/never one player measured against another/),
    ).not.toBeNull();
  });

  it("reads both signal families out of the vocabulary rather than its own copy", () => {
    // Not a pin on the wording -- `smurf-boost-vocabulary.test.ts` holds that.
    // What this rules out is the card spelling the copy inline, where an edit
    // to the vocabulary would leave the page showing the old sentences.
    render(<SmurfBoostExplanationCard />);

    for (const family of ["rapid_improvement", "playing_pattern_change"]) {
      expect(screen.getByText(FAMILY_TITLES[family] ?? "")).not.toBeNull();
      expect(
        screen.getByText(FAMILY_DESCRIPTIONS[family] ?? ""),
      ).not.toBeNull();
    }
  });

  it("shows the whole reading scale, thin data included", () => {
    render(<SmurfBoostExplanationCard />);

    for (const band of [
      "no_unusual_pattern",
      "weak_indicators",
      "notable_indicators",
      "strong_indicators",
      "not_enough_data",
    ] as const) {
      expect(screen.getByText(BAND_LABELS[band])).not.toBeNull();
    }
  });

  it("prints the disclaimer plainly, never behind a tooltip or a toggle", () => {
    // The specification requires it permanent and visible; a details/summary
    // or a tooltip trigger would satisfy a smoke test and fail the rule.
    render(<SmurfBoostExplanationCard />);

    const disclaimer = screen.getByText(DISCLAIMER);
    expect(disclaimer).not.toBeNull();
    expect(disclaimer.closest("details")).toBeNull();
    expect(disclaimer.closest("[role='tooltip']")).toBeNull();
  });
});
