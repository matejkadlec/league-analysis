// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PlayerCardSkeleton } from "@/components/loading-skeleton";

/** The skeleton blocks are the `Skeleton` divs: everything with the shared base. */
function skeletonBlocks(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLDivElement>('div[class*="bg-muted/40"]'),
  );
}

describe("PlayerCardSkeleton", () => {
  it("mimics the card it stands in for: one circular avatar, two header lines, eight grid bars", () => {
    const { container } = render(<PlayerCardSkeleton />);

    // The real card has an avatar, a name plus subtitle, and four stat pairs.
    // A skeleton with a different block count redraws the page when data
    // lands instead of filling the space it was holding.
    const blocks = skeletonBlocks(container);
    expect(blocks).toHaveLength(11);

    const round = blocks.filter((block) =>
      block.className.includes("rounded-full"),
    );
    expect(round).toHaveLength(1);

    // The header pair (name, subtitle) is wider than every stat label under
    // it, so the shimmer reads as a header row rather than nine same-sized
    // stripes.
    const widths = blocks.map((block) => block.className.match(/w-\d+/)?.[0]);
    expect(widths.filter((width) => width === "w-48")).toHaveLength(1);
    expect(widths.filter((width) => width === "w-32")).toHaveLength(2);
  });

  it("renders no text while it waits", () => {
    // The placeholder sits where the player's own data is about to appear;
    // any stray text in it would flash content that belongs to no one.
    const { container } = render(<PlayerCardSkeleton />);

    expect(container.textContent).toBe("");
    expect(
      container.querySelectorAll("h1,h2,h3,h4,p,li,button,a"),
    ).toHaveLength(0);
  });
});
