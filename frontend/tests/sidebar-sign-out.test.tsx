// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContextType } from "@/features/auth/types";

/**
 * One of exactly two callers allowed to pass `evenIfTheServerCannotBeReached`;
 * it arrives by React context, so no lint rule sees it.
 */

type Router = ReturnType<typeof import("next/navigation").useRouter>;

const nav = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({
    push: vi.fn<Router["push"]>(),
    replace: vi.fn<Router["replace"]>(),
  }),
}));

const auth = vi.hoisted(() => ({
  user: {
    display_name: "Signed In",
    email: "user@example.com",
    is_admin: false,
  },
  isAuthenticated: true,
  isLoading: false,
  logout: vi.fn<AuthContextType["logout"]>(async () => {}),
}));

vi.mock("@/features/auth", () => ({ useAuth: () => auth }));

vi.mock("@/features/players", () => ({
  isPlayerCentricPath: () => true,
  playerNavigationRoute: (route: string) => route,
  SidebarPlayerSwitcher: () => null,
}));

import { SidebarNav } from "@/components/sidebar-nav";

beforeEach(() => {
  auth.isAuthenticated = true;
  auth.logout.mockReset();
  auth.logout.mockImplementation(async () => {});
});

afterEach(() => {
  cleanup();
});

describe("the sidebar Sign Out button", () => {
  it("signs the visitor out even when the server cannot be reached", async () => {
    const user = userEvent.setup();
    // The context is mocked, so the only thing left to watch is what the
    // sidebar does with the signed-out state a completed logout leaves.
    auth.logout.mockImplementation(async () => {
      auth.isAuthenticated = false;
    });

    render(<SidebarNav />);

    // The menu is closed on a narrow viewport; open it if there is a toggle.
    const toggle = screen.queryByRole("button", { name: /menu/i });
    if (toggle) {
      await user.click(toggle);
    }

    await user.click(screen.getByRole("button", { name: /sign out/i }));

    expect(auth.logout).toHaveBeenCalledWith({
      evenIfTheServerCannotBeReached: true,
    });
    expect(screen.queryByRole("button", { name: /sign out/i })).toBeNull();
    expect(screen.queryByText("Signed In")).toBeNull();
  });

  it("goes dead while the request is in flight", async () => {
    const user = userEvent.setup();
    // Only the server can revoke, so a hung backend means the full ten-second
    // deadline; without the pending state each click stacks another request.
    let releaseServer: (() => void) | undefined;
    auth.logout.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseServer = resolve;
        }),
    );

    render(<SidebarNav />);
    const button = screen.getByRole("button", { name: /sign out/i });
    await user.click(button);

    expect(
      screen.getByRole("button", { name: /signing out/i }),
    ).toHaveProperty("disabled", true);
    expect(auth.logout).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /signing out/i }));
    expect(auth.logout).toHaveBeenCalledTimes(1);

    await act(async () => {
      releaseServer?.();
    });
  });
});
