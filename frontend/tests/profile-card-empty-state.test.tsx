// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { Swords } from "lucide-react";
import { describe, expect, it } from "vitest";

import { ProfileCardEmptyState } from "@/features/profile/components/profile-card-empty-state";

describe("the profile card empty state", () => {
  it("anchors an empty section where the page navigation can find it", () => {
    // `SectionQuickNavigation` finds a section by its anchor id, so a card that
    // drops the id vanishes from the navigation while still rendering.
    const { container } = render(
      <ProfileCardEmptyState
        icon={Swords}
        id="role-stats"
        title="Performance by Role"
        message="Not enough match data to analyze role performance yet."
      />,
    );

    const anchor = container.querySelector("#role-stats");
    expect(anchor).toBeTruthy();
    expect(anchor?.textContent).toContain("Performance by Role");
    expect(
      screen.getByText("Not enough match data to analyze role performance yet."),
    ).toBeTruthy();

    // The heading is a real heading carrying the section's icon, so screen
    // readers announce the section the same way as its filled counterparts.
    const heading = screen.getByRole("heading", {
      name: /Performance by Role/,
    });
    expect(heading.querySelector("svg")).toBeTruthy();
  });
});
