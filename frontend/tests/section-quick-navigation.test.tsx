// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SectionQuickNavigation } from "@/components/section-quick-navigation";

const scrollIntoView = vi.fn();

describe("SectionQuickNavigation", () => {
  beforeEach(() => {
    scrollIntoView.mockReset();
    Element.prototype.scrollIntoView = scrollIntoView;
  });


  it("stays off viewports too narrow to spare its fixed 40px", () => {
    render(
      <SectionQuickNavigation
        items={[{ label: "Player Summary", anchor: "#player-summary" }]}
      />,
    );

    // The tab is `fixed right-0`, so without this it overlays ~10% of a 390px
    // phone on every page that mounts it, permanently and on both sides of a
    // scroll.
    const className = screen.getByTestId("section-quick-navigation").className;
    expect(className).toContain("hidden");
    expect(className).toContain("sm:block");
  });

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
