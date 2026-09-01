// @vitest-environment jsdom

import type { ComponentProps } from "react";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `not-found`, `loading`, `error` and `global-error` render with no provider
 * mounted, which is the assertion: none of them may consult session state.
 */

import ErrorBoundary from "@/app/error";
import GlobalError from "@/app/global-error";
import Loading from "@/app/loading";
import NotFound from "@/app/not-found";

const thrown = new Error("render failed");

// `global-error.tsx` replaces the document, so its markup lands on
// `document.body`, not a container div -- `render()` would leave the previous test's button behind.

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
    const reset = vi.fn<ComponentProps<typeof ErrorBoundary>["reset"]>();
    render(<ErrorBoundary error={thrown} reset={reset} />);

    expect(screen.getByText("This page could not be loaded")).toBeTruthy();
    screen.getByRole("button", { name: "Try again" }).click();
    expect(reset).toHaveBeenCalled();
  });

  it("offers a reset when the layout itself throws", () => {
    // `error.tsx` sits inside the layout, so a throw from the providers, the
    // gate or the sidebar reaches only this one.
    const reset = vi.fn<ComponentProps<typeof GlobalError>["reset"]>();
    render(<GlobalError error={thrown} reset={reset} />);

    expect(screen.getByText("Something went wrong")).toBeTruthy();
    screen.getByRole("button", { name: "Try again" }).click();
    expect(reset).toHaveBeenCalled();
  });

  it("brings its own document, because it replaces the one that threw", () => {
    // What `global-error.tsx` returns is the document itself, and jsdom will
    // not nest an `html`, so this is asserted against server markup.
    const markup = renderToStaticMarkup(
      <GlobalError error={thrown} reset={() => {}} />,
    );

    expect(markup.startsWith("<html")).toBe(true);
    expect(markup).toContain("<body");
  });
});
