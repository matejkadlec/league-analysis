// @vitest-environment jsdom

import { act, cleanup, screen, waitFor } from "@testing-library/react";

import { renderWithQueryClient } from "./support/render-support";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthGate } from "@/components/auth-gate";
import { AuthProvider, useAuth } from "@/features/auth/context/auth-context";
import {
  AUTH_STATE_COOKIE_NAME,
  AUTH_STATE_COOKIE_VALUE,
} from "@/lib/session/auth-state-cookie";
import type { AuthContextType } from "@/features/auth/types";

/** A complete `UserResponse`; `UserResponseSchema` rejects anything less. */
function userBody(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    email: "someone@example.com",
    display_name: "Someone",
    is_active: true,
    is_admin: false,
    email_verified: true,
    email_verified_at: null,
    last_login: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * `login` raises `isLoading` and only the `checkAuth()` in its `finally`
 * lowers it, so losing that line pins every route on "Checking your session".
 */

type Router = ReturnType<typeof import("next/navigation").useRouter>;

const nav = vi.hoisted(() => ({
  push: vi.fn<Router["push"]>(),
  replace: vi.fn<Router["replace"]>(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

let startLogin: AuthContextType["login"] | null = null;

function LoginProbe() {
  const { login } = useAuth();
  useEffect(() => {
    startLogin = login;
  }, [login]);
  return null;
}

function clearCookies() {
  for (const entry of document.cookie.split("; ")) {
    const name = entry.split("=")[0];
    if (name) {
      document.cookie = `${name}=; max-age=0; path=/`;
    }
  }
}

beforeEach(() => {
  startLogin = null;
  nav.push.mockClear();
  clearCookies();
});

afterEach(() => {
  cleanup();
  clearCookies();
  vi.restoreAllMocks();
});

describe("signing in", () => {
  it("draws the app, rather than checking a session forever", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/auth/login")) {
        // What `set_auth_cookies` does: the two tokens are HttpOnly and
        // invisible here, the hint is not.
        document.cookie = `${AUTH_STATE_COOKIE_NAME}=${AUTH_STATE_COOKIE_VALUE}; path=/`;
        return new Response(JSON.stringify({ access_token: "a" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify(userBody({ id: 1, email: "someone@example.com" })),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    renderWithQueryClient(
      <AuthProvider>
        <LoginProbe />
        <AuthGate>protected content</AuthGate>
      </AuthProvider>,
    );
    await waitFor(() => expect(startLogin).not.toBeNull());

    await act(async () => {
      await startLogin?.({
        email: "someone@example.com",
        password: "secret-password",
      });
    });

    await waitFor(() =>
      expect(screen.getByText("protected content")).toBeTruthy(),
    );
    expect(nav.push).toHaveBeenCalledWith("/");
  });
});
