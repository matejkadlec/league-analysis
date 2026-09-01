// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  SectionQuickNavigation,
  type SectionQuickNavigationItem,
} from "@/components/section-quick-navigation";

const scrollIntoView = vi.fn<typeof Element.prototype.scrollIntoView>();

// Module level, as the pages declare theirs: a literal rebuilt each render is
// a new dependency, re-running the effect and hiding what the observer does.
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

    // The tab is `fixed right-0`, so without this it permanently overlays ~10%
    // of a 390px phone.
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

    expect(
      screen
        .getByRole("button", { name: "Open page navigation" })
        .getAttribute("aria-expanded"),
    ).toBe("false");

    await user.hover(quickNavigation);

    expect(
      screen
        .getByRole("button", { name: "Close page navigation" })
        .getAttribute("aria-expanded"),
    ).toBe("true");

    await user.unhover(quickNavigation);

    await user.click(
      screen.getByRole("button", { name: "Open page navigation" }),
    );

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

    // The list is the page's rendered sections, so a page cannot advertise a
    // section it has not rendered.
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
    // A re-render re-runs the effect on its own; adding the node without
    // React's help leaves the observer as the only explanation.
    const user = userEvent.setup();
    render(<Page withResult={false} />);
    await user.hover(screen.getByTestId("section-quick-navigation"));
    expect(screen.queryByRole("button", { name: "Result" })).toBeNull();

    const late = document.createElement("section");
    late.id = "smurf-boost-result";
    document.body.append(late);

    await screen.findByRole("button", { name: "Result" });

    // Appended outside React, so RTL's cleanup does not own it: left behind it
    // makes the next test's page advertise a section it never rendered.
    late.remove();
  });

  it("does no watching while the panel is shut", async () => {
    // The observer watches `document.body` with `subtree: true`, so a polling
    // page would fire it constantly for a list nobody can read.
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

  it("keeps the panel pinned while focus moves between its own items", async () => {
    // `onBlurCapture` fires for focus moving *within* the panel, so reading
    // containment backwards leaves the list usable only with a mouse.
    const user = userEvent.setup();
    render(
      <>
        <Page withResult />
        <button type="button">Elsewhere</button>
      </>,
    );

    const quickNavigation = screen.getByTestId("section-quick-navigation");
    const tab = screen.getByRole("button", { name: "Open page navigation" });
    await user.click(tab);
    await user.unhover(quickNavigation);
    expect(tab.getAttribute("aria-expanded")).toBe("true");

    await user.tab();
    expect(quickNavigation.contains(document.activeElement)).toBe(true);
    expect(tab.getAttribute("aria-expanded")).toBe("true");

    await user.click(screen.getByRole("button", { name: "Elsewhere" }));
    expect(tab.getAttribute("aria-expanded")).toBe("false");
  });

  it("takes its items out of the tab order once shut", async () => {
    // A shut panel keeps its items mounted and only `aria-hidden` hides them,
    // so a focusable item there is reachable by tab and never visible.
    const user = userEvent.setup();
    render(<Page withResult />);
    const quickNavigation = screen.getByTestId("section-quick-navigation");

    await user.hover(quickNavigation);
    const items = () =>
      Array.from(quickNavigation.querySelectorAll("nav button"));
    expect(items().map((item) => item.getAttribute("tabindex"))).toEqual([
      "0",
      "0",
    ]);

    await user.unhover(quickNavigation);
    expect(items()).toHaveLength(2);
    expect(items().map((item) => item.getAttribute("tabindex"))).toEqual([
      "-1",
      "-1",
    ]);
  });
});
