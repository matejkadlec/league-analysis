// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `not-found`, `loading`, `error` and `global-error` each rendered `null`
 * unless `useAuth()` said the visitor was authenticated -- the blank page in
 * the report. These render with no provider mounted at all, which is the
 * assertion: none of them may consult session state.
 */

import ErrorBoundary from "@/app/error";
import GlobalError from "@/app/global-error";
import Loading from "@/app/loading";
import NotFound from "@/app/not-found";

const thrown = new Error("render failed");

// `global-error.tsx` replaces the document, so its markup lands on
// document.body rather than a container div. Without this the previous
// test's "Try again" button is still there and the query finds two.

describe("the shells shown when there is no page to show", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

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
    // gate or the sidebar reaches only this one.
    const reset = vi.fn();
    render(<GlobalError error={thrown} reset={reset} />);

    expect(screen.getByText("Something went wrong")).toBeTruthy();
    screen.getByRole("button", { name: "Try again" }).click();
    expect(reset).toHaveBeenCalled();
  });

  it("brings its own document, because it replaces the one that threw", () => {
    // Next renders `global-error.tsx` in place of the root layout, so what it
    // returns *is* the document: without its own `html` and `body` there is
    // nothing to render into. jsdom will not nest an `html`, so this is asserted
    // against server markup.
    const markup = renderToStaticMarkup(
      <GlobalError error={thrown} reset={() => {}} />,
    );

    expect(markup.startsWith("<html")).toBe(true);
    expect(markup).toContain("<body");
  });
});
