// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Progress } from "@/components/ui/progress";

/** The indicator bar: the root's only child, whose transform is the fill. */
function indicator(progressbar: HTMLElement) {
  const bar = progressbar.firstElementChild as HTMLElement | null;
  expect(bar).not.toBeNull();
  return bar as HTMLElement;
}

describe("Progress", () => {
  it("reports the track bounds through the progressbar role", () => {
    // The value must reach the Radix root: without it the role reads as
    // indeterminate to assistive tech even while the fill shows progress.
    render(<Progress value={40} aria-label="Sync progress" />);

    const bar = screen.getByRole("progressbar", { name: "Sync progress" });
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
    expect(bar.getAttribute("aria-valuenow")).toBe("40");
  });

  it("fills the track by exactly the value given", () => {
    // The fill is `translateX(-${100 - value}%)`: the one place the bar's
    // geometry is computed, and a place an edit to the template quietly
    // inverts (a bar that shrinks as the value grows).
    const { rerender } = render(<Progress value={40} />);
    const track = screen.getByRole("progressbar");

    expect(indicator(track).style.transform).toBe("translateX(-60%)");

    rerender(<Progress value={25} />);
    expect(indicator(track).style.transform).toBe("translateX(-75%)");

    rerender(<Progress value={100} />);
    expect(indicator(track).style.transform).toBe("translateX(-0%)");
  });

  it("treats a missing or zero value as an empty track, never a full one", () => {
    // `value || 0` is deliberate: `undefined` must not fall through to a
    // fully-filled bar, which would read as complete before anything ran.
    const { rerender } = render(<Progress />);
    const track = screen.getByRole("progressbar");
    expect(indicator(track).style.transform).toBe("translateX(-100%)");

    rerender(<Progress value={0} />);
    expect(indicator(track).style.transform).toBe("translateX(-100%)");
  });

  it("accepts a caller's width without losing the track styling", () => {
    // Call sites shrink the height or narrow the track; the primitive's own
    // width class must stay overridable rather than fighting the caller.
    render(<Progress value={50} className="h-2 w-1/2" />);
    const track = screen.getByRole("progressbar");

    expect(track.className).toContain("rounded-full");
    expect(track.className).toMatch(/h-2\b/);
    expect(track.className).toMatch(/w-1\/2\b/);
  });
});
