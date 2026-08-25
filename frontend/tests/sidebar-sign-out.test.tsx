// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sign Out is one of exactly two callers allowed to pass
 * `evenIfTheServerCannotBeReached`. It arrives by React context, so no lint
 * rule sees it and only this file holds the flag on.
 */

const nav = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const auth = vi.hoisted(() => ({
  user: {
    display_name: "Signed In",
    email: "user@example.com",
    is_admin: false,
  },
  isAuthenticated: true,
  isLoading: false,
  logout: vi.fn(async () => {}),
}));

vi.mock("@/features/auth", () => ({ useAuth: () => auth }));

vi.mock("@/features/players", () => ({
  isPlayerCentricPath: () => true,
  playerNavigationRoute: (route: string) => route,
  SidebarPlayerSwitcher: () => null,
}));

import { SidebarNav } from "@/components/sidebar-nav";

beforeEach(() => {
  auth.logout.mockReset();
  auth.logout.mockImplementation(async () => {});
});

afterEach(() => {
  cleanup();
});

describe("the sidebar Sign Out button", () => {
  it("signs the visitor out even when the server cannot be reached", async () => {
    render(<SidebarNav />);

    // The menu is closed on a narrow viewport; open it if there is a toggle.
    const toggle = screen.queryByRole("button", { name: /menu/i });
    if (toggle) {
      await act(async () => {
        fireEvent.click(toggle);
      });
    }

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    });

    expect(auth.logout).toHaveBeenCalledWith({
      evenIfTheServerCannotBeReached: true,
    });
  });

  it("goes dead while the request is in flight", async () => {
    // Sign Out waits for the server, because only the server can revoke.
    // Against a backend that hangs that is the full ten-second deadline with
    // nothing on screen moving, so without the pending state the button reads
    // as broken and every further click stacks another request.
    let releaseServer: (() => void) | undefined;
    auth.logout.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseServer = resolve;
        }),
    );

    render(<SidebarNav />);
    const button = screen.getByRole("button", { name: /sign out/i });
    await act(async () => {
      fireEvent.click(button);
    });

    expect(
      screen.getByRole("button", { name: /signing out/i }),
    ).toHaveProperty("disabled", true);
    expect(auth.logout).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /signing out/i }));
    });
    expect(auth.logout).toHaveBeenCalledTimes(1);

    await act(async () => {
      releaseServer?.();
    });
  });
});
