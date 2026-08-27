// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AnalyzedPlayerResultLabel } from "@/features/matchmaking/components/analyzed-player-result-label";

// The sentence is split across styled spans, so it is matched on the
// paragraph's own text rather than on any one child.
function sentence(playerLabel: string) {
  return (_: string, element: Element | null) =>
    element?.tagName === "P" &&
    element.textContent === `Results for player ${playerLabel}`;
}

describe("the analyzed-player result label", () => {
  it("reads as one exact sentence with the player's name in it", () => {
    // `e2e/player-context.spec.ts` matches this sentence word for word. The
    // split spans are styling only; the sentence the viewer reads is the
    // whole paragraph.
    render(<AnalyzedPlayerResultLabel playerLabel="Hide on bush#KR1" />);

    expect(screen.getByText(sentence("Hide on bush#KR1"))).toBeTruthy();
  });

  it("carries whichever player each surface is describing", () => {
    // The results card and the history list share this label precisely so
    // they cannot drift; both spellings render identically through it.
    render(
      <>
        <AnalyzedPlayerResultLabel playerLabel="Analyzed#ONE" />
        <AnalyzedPlayerResultLabel playerLabel="Other#TWO" />
      </>,
    );

    expect(screen.getByText(sentence("Analyzed#ONE"))).toBeTruthy();
    expect(screen.getByText(sentence("Other#TWO"))).toBeTruthy();
  });
});
