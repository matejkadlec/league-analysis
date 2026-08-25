// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Which PUUID the sidebar may carry onto a player link. `/matchmaking-analysis`
 * spells its analyzed player `?puuid=` too, but page-locally; unscoped, the
 * sidebar would hand it to `/player-overview`, which persists it.
 */

const nav = vi.hoisted(() => ({ pathname: "/", search: "" }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/features/auth", () => ({
  useAuth: () => ({
    user: { display_name: "Signed In", email: "u@example.com", is_admin: false },
    isAuthenticated: true,
    isLoading: false,
    logout: vi.fn(async () => {}),
  }),
}));

// Only the switcher is stubbed: `isPlayerCentricPath` and
// `playerNavigationRoute` are what this test is about, so they stay real.
vi.mock("@/features/players", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/players")>()),
  SidebarPlayerSwitcher: () => null,
}));

import { SidebarNav } from "@/components/sidebar-nav";

function overviewHref() {
  return screen
    .getByRole("link", { name: "Player Overview" })
    .getAttribute("href");
}

afterEach(cleanup);

describe("the PUUID the sidebar carries onto player links", () => {
  it("carries it from one player page to another", () => {
    nav.pathname = "/player-overview";
    nav.search = "puuid=reference-puuid";
    render(<SidebarNav />);

    expect(
      screen.getByRole("link", { name: "Match History" }).getAttribute("href"),
    ).toBe("/match-history?puuid=reference-puuid");
  });

  it("leaves the matchmaking page's analyzed player behind", () => {
    nav.pathname = "/matchmaking-analysis";
    nav.search = "puuid=analyzed-puuid";
    render(<SidebarNav />);

    // Bare, so the provider seeds the account's own saved player instead.
    expect(overviewHref()).toBe("/player-overview");
  });
});
