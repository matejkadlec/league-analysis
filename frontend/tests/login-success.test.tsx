// @vitest-environment jsdom

import { act, cleanup, screen, waitFor } from "@testing-library/react";

import { renderWithQueryClient } from "./render-support";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthGate } from "@/components/auth-gate";
import { AuthProvider, useAuth } from "@/features/auth/context/auth-context";
import {
  AUTH_STATE_COOKIE_NAME,
  AUTH_STATE_COOKIE_VALUE,
} from "@/features/auth/utils/auth-state-cookie";
import type { AuthContextType } from "@/features/auth/types";

/**
 * Signing in successfully, which nothing in this repo covered.
 *
 * `login` raises `isLoading` on the way in and never lowers it on the success
 * path -- only the `checkAuth()` at the end does, in its `finally`. So that
 * one line carries the whole flow, and deleting it left all 320 tests green:
 * the other login tests mock the token manager and exercise timeouts, and
 * every Playwright spec seeds the hint cookie directly rather than submitting
 * the form.
 *
 * With it gone the visitor types the right password, the server answers 200
 * and sets all three cookies, and every route renders "Checking your
 * session..." for the rest of the tab's life, over a perfectly valid 30-day
 * session sitting in the jar.
 */

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));

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
        JSON.stringify({ id: 1, email: "someone@example.com" }),
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
