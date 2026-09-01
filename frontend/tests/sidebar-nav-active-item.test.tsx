// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthContextType } from "@/features/auth/types";

/**
 * Every path starts with "/", so Home needs an exact match: a prefix test alone
 * highlights it on every page at once.
 */

type Router = ReturnType<typeof import("next/navigation").useRouter>;

const nav = vi.hoisted(() => ({ pathname: "/", search: "" }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({
    push: vi.fn<Router["push"]>(),
    replace: vi.fn<Router["replace"]>(),
  }),
}));

vi.mock("@/features/auth", () => ({
  useAuth: () => ({
    user: {
      display_name: "Signed In",
      email: "u@example.com",
      is_admin: false,
    },
    isAuthenticated: true,
    isLoading: false,
    logout: vi.fn<AuthContextType["logout"]>(async () => {}),
  }),
}));

vi.mock("@/features/players", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/players")>()),
  SidebarPlayerSwitcher: () => null,
}));

import { SidebarNav } from "@/components/sidebar-nav";

function activeLinkNames(): string[] {
  return screen
    .getAllByRole("link")
    .filter((link) => link.getAttribute("data-active") === "true")
    .map((link) => link.textContent?.trim() ?? "");
}

afterEach(cleanup);

describe("the sidebar entry marked as current", () => {
  it("marks exactly the section being viewed", () => {
    nav.pathname = "/match-history";
    nav.search = "";
    render(<SidebarNav />);

    expect(activeLinkNames()).toEqual(["Match History"]);
  });

  it("marks Home only on Home itself", () => {
    nav.pathname = "/";
    nav.search = "";
    const home = render(<SidebarNav />);
    expect(activeLinkNames()).toEqual(["Home"]);
    home.unmount();

    nav.pathname = "/player-overview";
    render(<SidebarNav />);
    expect(activeLinkNames()).toEqual(["Player Overview"]);
  });

  it("keeps a section marked on its nested pages", () => {
    nav.pathname = "/matchmaking-analysis/history";
    nav.search = "";
    render(<SidebarNav />);

    expect(activeLinkNames()).toEqual(["Matchmaking Analysis"]);
  });
});
