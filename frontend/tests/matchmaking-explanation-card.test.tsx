// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
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

  it("folds the chart away and brings it back", () => {
    render(<MatchmakingExplanationCard />);

    fireEvent.click(screen.getByRole("button", { name: /Collapse/ }));

    const chart = screen.getByAltText(
      "Matchmaking Analysis Calculation Explanation",
    );
    // Collapsed: faded to invisible, and the toggle now offers Expand.
    expect(chart.className).toContain("opacity-0");
    expect(screen.getByRole("button", { name: /Expand/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Expand/ }));
    expect(chart.className).toContain("opacity-100");
    expect(screen.getByRole("button", { name: /Collapse/ })).toBeTruthy();
  });

  it("keeps explaining the model even while collapsed", () => {
    // The prose is the card's other half: it stays readable with the chart
    // folded, which is the point of folding rather than hiding the card.
    render(<MatchmakingExplanationCard />);
    fireEvent.click(screen.getByRole("button", { name: /Collapse/ }));

    expect(
      screen.getByText(/A visual representation of how the matchmaking/),
    ).toBeTruthy();
  });
});
