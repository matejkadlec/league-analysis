// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The four files this branch exists for, and nothing was watching them.
 *
 * `not-found`, `loading`, `error` and `global-error` each used to render
 * `null` unless `useAuth()` said the visitor was authenticated -- which is the
 * blank page in the report. Reverting all four to those bodies left the suite
 * at 337 passing, and left the coverage summary byte-identical: vitest's
 * default scope is "files a test imported", so `app/` was in neither the
 * numerator nor the denominator and no ratchet could ever reach it.
 *
 * These render with no provider mounted at all. That is the assertion: the
 * shells must not consult session state, because every one of them is on
 * screen at a moment when the session is unknown or unavailable.
 */

import ErrorBoundary from "@/app/error";
import GlobalError from "@/app/global-error";
import Loading from "@/app/loading";
import NotFound from "@/app/not-found";

const thrown = new Error("render failed");

// `global-error.tsx` replaces the document, so its markup lands on
// document.body rather than a container div. Without this the previous
// test's "Try again" button is still there and the query finds two.
afterEach(cleanup);

describe("the shells shown when there is no page to show", () => {
  it("names a 404 and offers the way back, signed out", () => {
    render(<NotFound />);

    expect(screen.getByText("This page does not exist")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Go to home page" })
        .getAttribute("href"),
    ).toBe("/");
  });

  it("draws a skeleton while a route loads, signed out", () => {
    // The redirect a signed-out visitor gets needs the session probe to
    // finish, so this is exactly the wait that used to be blank.
    const { container } = render(<Loading />);

    expect(
      container.querySelectorAll("div.animate-pulse, div.bg-muted\\/40").length,
    ).toBeGreaterThan(0);
  });

  it("offers a reset when the page segment throws", () => {
    const reset = vi.fn();
    render(<ErrorBoundary error={thrown} reset={reset} />);

    expect(screen.getByText("This page could not be loaded")).toBeTruthy();
    screen.getByRole("button", { name: "Try again" }).click();
    expect(reset).toHaveBeenCalled();
  });

  it("offers a reset when the layout itself throws", () => {
    // `error.tsx` sits inside the layout, so a throw from the providers, the
    // gate or the sidebar reaches only this one. It replaces the document,
    // hence its own html/body and inline styles.
    const reset = vi.fn();
    render(<GlobalError error={thrown} reset={reset} />);

    expect(screen.getByText("Something went wrong")).toBeTruthy();
    screen.getByRole("button", { name: "Try again" }).click();
    expect(reset).toHaveBeenCalled();
  });
});
