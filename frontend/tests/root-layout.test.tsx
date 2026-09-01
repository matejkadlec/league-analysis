// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Asserted against server markup because the layout's root is `<html>`, which
 * jsdom will not nest (see `app-shell-boundaries.test.tsx`).
 */

vi.mock("next/font/google", () => ({
  // Font loaders would reach out to Google and the filesystem; the layout
  // only consumes each result's `variable` class.
  Montserrat: () => ({ variable: "mock-sans-variable" }),
}));
vi.mock("next/font/local", () => ({
  default: () => ({ variable: "mock-league-variable" }),
}));

const { resolveDDragonVersion } = vi.hoisted(() => ({
  resolveDDragonVersion:
    vi.fn<
      typeof import("@/lib/core/riot/data-dragon-version").resolveDDragonVersion
    >(),
}));

vi.mock("@/lib/core/riot/data-dragon-version", () => ({
  resolveDDragonVersion,
}));

vi.mock("@/components/providers", () => ({
  Providers: ({
    children,
    ddragonVersion,
  }: {
    children: React.ReactNode;
    ddragonVersion: string;
  }) => (
    <div data-testid="providers" data-ddragon-version={ddragonVersion}>
      {children}
    </div>
  ),
}));

vi.mock("@/components/header-messages", () => ({
  HeaderMessages: () => <div data-testid="header-messages" />,
}));
vi.mock("@/components/sidebar-nav", () => ({
  SidebarNav: () => <nav data-testid="sidebar-nav" />,
}));
vi.mock("@/features/cookie-consent", () => ({
  CookieConsentManager: () => <div data-testid="cookie-consent" />,
}));
vi.mock("@/components/toast-host", () => ({
  ToastHost: () => <div data-testid="toast-host" />,
}));

import RootLayout from "@/app/layout";

beforeEach(() => {
  resolveDDragonVersion.mockReset();
  resolveDDragonVersion.mockResolvedValue("15.1.1");
});

/** The layout's markup, parsed back into a DOM so containment is a query. */
function renderShell() {
  return RootLayout({
    children: <p data-testid="page-child">page content</p>,
  }).then((tree) => {
    const markup = renderToStaticMarkup(tree);
    const fragment = document.createElement("div");
    fragment.innerHTML = markup;
    return { markup, fragment };
  });
}

describe("the root layout", () => {
  it("draws the dark document and hands the resolved patch version to the providers", async () => {
    const { markup, fragment } = await renderShell();

    expect(markup.startsWith("<html")).toBe(true);
    expect(markup).toContain('lang="en"');
    // `dark` on the element, not chosen at runtime: there is no light design.
    expect(markup).toContain('class="dark"');
    expect(fragment.querySelector('[data-testid="providers"]')?.outerHTML).toContain(
      'data-ddragon-version="15.1.1"',
    );
  });

  it("renders the page inside the providers' main, with the shell around it", async () => {
    const { fragment } = await renderShell();

    const providers = fragment.querySelector('[data-testid="providers"]');
    const main = fragment.querySelector("main#content");
    const pageChild = fragment.querySelector('[data-testid="page-child"]');
    const headerMessages = fragment.querySelector(
      '[data-testid="header-messages"]',
    );
    const sidebarNav = fragment.querySelector('[data-testid="sidebar-nav"]');

    expect(providers).not.toBeNull();
    expect(main).not.toBeNull();
    expect(pageChild).not.toBeNull();
    // The claim is containment, not coexistence: the page must land inside
    // the providers' main, not merely somewhere on the document.
    expect(providers!.contains(main!)).toBe(true);
    expect(main!.contains(pageChild!)).toBe(true);

    // The rest of the shell: messages and sidebar alongside the page; the
    // consent manager and toasts come after it.
    expect(providers!.contains(headerMessages!)).toBe(true);
    expect(providers!.contains(sidebarNav!)).toBe(true);
    expect(
      fragment.querySelector('[data-testid="cookie-consent"]'),
    ).not.toBeNull();
    expect(fragment.querySelector('[data-testid="toast-host"]')).not.toBeNull();
  });

  it("describes the site in metadata and stays uncrawlable unless indexing was asked for", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://leagueanalysis.gg");
    vi.stubEnv("NEXT_PUBLIC_ALLOW_INDEXING", undefined);
    vi.resetModules();
    const { metadata } = await import("@/app/layout");

    expect(metadata.title).toBe("League Analysis");
    expect(metadata.metadataBase).toEqual(new URL("https://leagueanalysis.gg"));
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });

  it("flips the metadata's robots to open when indexing is enabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://leagueanalysis.gg");
    vi.stubEnv("NEXT_PUBLIC_ALLOW_INDEXING", "true");
    vi.resetModules();
    const { metadata } = await import("@/app/layout");

    expect(metadata.robots).toMatchObject({ index: true, follow: true });
  });
});
