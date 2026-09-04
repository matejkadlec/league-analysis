// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PlayerCardSkeleton } from "@/features/players/components/player-card-skeleton";

describe("PlayerCardSkeleton", () => {
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
