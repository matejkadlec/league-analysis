// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Being refused has to say so: rendering `null` left a signed-in non-admin on
 * /jobs looking at an empty pane with nothing they could do about it. Both
 * returns could be replaced with `null` and every gate stayed green.
 */

const auth = vi.hoisted(() => ({
  user: {
    display_name: "Signed In",
    email: "user@example.com",
    is_admin: false,
    is_active: true,
  },
  isAuthenticated: true,
  isLoading: false,
}));

vi.mock("@/features/auth/context/auth-context", () => ({
  useAuth: () => auth,
}));

import { ProtectedRoute } from "@/features/auth/components/protected-route";

afterEach(() => {
  cleanup();
  auth.user.is_admin = false;
  auth.user.is_active = true;
  auth.isAuthenticated = true;
  auth.isLoading = false;
});

describe("a page the visitor may not have", () => {
  it("tells a non-admin why, rather than drawing nothing", () => {
    render(
      <ProtectedRoute requireAdmin>
        <p>admin content</p>
      </ProtectedRoute>,
    );

    expect(
      screen.getByText("You don't have access to this page"),
    ).toBeTruthy();
    expect(screen.getByText(/limited to administrators/)).toBeTruthy();
    expect(screen.queryByText("admin content")).toBeNull();
  });

  it("tells a deactivated account why, rather than drawing nothing", () => {
    auth.user.is_active = false;

    render(
      <ProtectedRoute>
        <p>member content</p>
      </ProtectedRoute>,
    );

    expect(
      screen.getByText("You don't have access to this page"),
    ).toBeTruthy();
    // The exact wording, not a substring: this surface and the sign-in form
    // answer the same condition, and a loose match let them drift apart.
    expect(
      screen.getByText(
        "This account is inactive. Contact an administrator to restore access.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("member content")).toBeNull();
  });

  it("draws the page for an admin", () => {
    // The other direction, so "refuse everyone" cannot satisfy the tests
    // above.
    auth.user.is_admin = true;

    render(
      <ProtectedRoute requireAdmin>
        <p>admin content</p>
      </ProtectedRoute>,
    );

    expect(screen.getByText("admin content")).toBeTruthy();
  });

  it("draws nothing while the session is still being checked", () => {
    // Not a refusal: the answer is not in yet, and `AuthGate` owns what the
    // visitor sees during a probe. Saying "no access" here would accuse
    // everyone whose probe is slow.
    auth.isLoading = true;

    render(
      <ProtectedRoute requireAdmin>
        <p>admin content</p>
      </ProtectedRoute>,
    );

    expect(screen.queryByText("You don't have access to this page")).toBeNull();
    expect(screen.queryByText("admin content")).toBeNull();
  });
});
