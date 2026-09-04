// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// A pass-through <img>: the real next/image needs a loader jsdom does not
// have, and the card's own contract is only which picture it asks for and
// how visibly it shows it.
vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    className,
  }: {
    src: string;
    alt: string;
    className?: string;
  }) => (
    // oxlint-disable-next-line next/no-img-element
    <img src={src} alt={alt} className={className} />
  ),
}));

import { MatchmakingExplanationCard } from "@/features/matchmaking/components/matchmaking-explanation-card";

describe("the calculation flowchart card", () => {
  it("opens on the flowchart", () => {
    render(<MatchmakingExplanationCard />);

    const chart = screen.getByAltText(
      "Matchmaking Analysis Calculation Explanation",
    ) as HTMLImageElement;
    expect(chart.src).toContain("/matchmaking_analysis.png");
    // Expanded: the chart is at full opacity and the toggle offers to fold it.
    expect(chart.className).toContain("opacity-100");
    expect(
      screen.getByRole("button", { name: /Collapse/ }),
    ).toBeTruthy();
  });
});
