// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SectionQuickNavigation } from "@/components/section-quick-navigation";

const scrollIntoView = vi.fn();

describe("SectionQuickNavigation", () => {
  beforeEach(() => {
    scrollIntoView.mockReset();
    Element.prototype.scrollIntoView = scrollIntoView;
  });

  afterEach(() => cleanup());

  it("restores the hover expansion and smoothly scrolls to a section", async () => {
    const user = userEvent.setup();
    render(
      <>
        <SectionQuickNavigation
          items={[
            { label: "Player Summary", anchor: "#player-summary" },
            { label: "Top Champions", anchor: "#top-champions" },
          ]}
        />
        <section id="top-champions">Champions</section>
      </>,
    );

    const quickNavigation = screen.getByTestId("section-quick-navigation");
    const navigation = screen.getByRole("navigation", {
      name: "Page sections",
      hidden: true,
    });

    expect(navigation.parentElement?.className).toContain("w-0");
    expect(
      screen
        .getByRole("button", { name: "Open page navigation" })
        .getAttribute("aria-expanded"),
    ).toBe("false");

    await user.hover(quickNavigation);

    expect(navigation.parentElement?.className).toContain("w-[180px]");
    expect(
      screen
        .getByRole("button", { name: "Close page navigation" })
        .getAttribute("aria-expanded"),
    ).toBe("true");

    await user.unhover(quickNavigation);
    expect(navigation.parentElement?.className).toContain("w-0");

    await user.click(
      screen.getByRole("button", { name: "Open page navigation" }),
    );
    expect(navigation.parentElement?.className).toContain("w-[180px]");

    await user.click(screen.getByRole("button", { name: "Top Champions" }));

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
  });
});
