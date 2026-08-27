// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  SectionQuickNavigation,
  type SectionQuickNavigationItem,
} from "@/components/section-quick-navigation";

const scrollIntoView = vi.fn();

// Module level, exactly as the pages declare theirs: an array literal rebuilt
// on each render is a new dependency every time, which re-runs the effect and
// hides whether the observer does anything.
const ITEMS: SectionQuickNavigationItem[] = [
  { label: "Games Comparison", anchor: "#smurf-boost-run" },
  { label: "Result", anchor: "#smurf-boost-result" },
];

function Page({ withResult }: { withResult: boolean }) {
  return (
    <>
      <SectionQuickNavigation items={ITEMS} />
      <section id="smurf-boost-run">Run</section>
      {withResult && <section id="smurf-boost-result">Result</section>}
    </>
  );
}

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

  it("offers only the sections that are on the page", async () => {
    const user = userEvent.setup();

    const { rerender } = render(<Page withResult={false} />);
    await user.hover(screen.getByTestId("section-quick-navigation"));

    // Rank Manipulation listed `Result` before any comparison had produced
    // one, and clicking it did nothing at all. The list is the page's rendered
    // sections, so a page cannot advertise a section it has not rendered.
    expect(
      screen.getByRole("button", { name: "Games Comparison" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Result" })).toBeNull();

    // Still hovered: a result that arrives while the panel is open appears
    // without needing it closed and reopened first.
    rerender(<Page withResult />);
    await screen.findByRole("button", { name: "Result" });

    await user.click(screen.getByRole("button", { name: "Result" }));
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
  });

  it("notices a section that arrives from outside React", async () => {
    // The test above re-renders, and a re-render re-runs the effect on its own --
    // which is why it passed with the observer deleted. This adds the node without
    // React's help, so nothing else can explain the update.
    const user = userEvent.setup();
    render(<Page withResult={false} />);
    await user.hover(screen.getByTestId("section-quick-navigation"));
    expect(screen.queryByRole("button", { name: "Result" })).toBeNull();

    const late = document.createElement("section");
    late.id = "smurf-boost-result";
    document.body.append(late);

    await screen.findByRole("button", { name: "Result" });
  });

  it("does no watching while the panel is shut", async () => {
    // The observer is on `document.body` with `subtree: true`, so it sees
    // every DOM change on the page -- on a surface that polls, a callback
    // several times a minute for a list nobody can read while collapsed.
    const user = userEvent.setup();
    const observe = vi.spyOn(MutationObserver.prototype, "observe");
    const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");

    render(<Page withResult />);
    // The reason there is nothing to watch, and the observable the spies
    // above stand on: a shut panel lists nothing, before or after.
    expect(screen.queryByRole("button", { name: "Result" })).toBeNull();
    expect(observe).not.toHaveBeenCalled();

    const quickNavigation = screen.getByTestId("section-quick-navigation");
    await user.hover(quickNavigation);
    expect(screen.getByRole("button", { name: "Result" })).toBeTruthy();
    expect(observe).toHaveBeenCalledTimes(1);

    await user.unhover(quickNavigation);
    expect(screen.queryByRole("button", { name: "Result" })).toBeNull();
    expect(disconnect).toHaveBeenCalledTimes(1);

    observe.mockRestore();
    disconnect.mockRestore();
  });
});
