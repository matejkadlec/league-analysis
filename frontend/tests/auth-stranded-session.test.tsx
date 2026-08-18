// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthGate } from "@/components/auth-gate";
import {
  markAuthSession,
  refreshAccessToken,
  removeAuthTokens,
} from "@/features/auth/utils/token-manager";
import {
  AUTH_STATE_COOKIE_NAME,
  AUTH_STATE_COOKIE_VALUE,
  hasAuthStateCookie,
} from "@/features/auth/utils/auth-state-cookie";

const nav = vi.hoisted(() => ({ replace: vi.fn(), pathname: "/" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  usePathname: () => nav.pathname,
}));

const auth = vi.hoisted(() => ({ isAuthenticated: false, isLoading: false }));

vi.mock("@/features/auth", () => ({
  useAuth: () => auth,
}));

function setHint() {
  document.cookie = `${AUTH_STATE_COOKIE_NAME}=${AUTH_STATE_COOKIE_VALUE}; path=/`;
}

function clearHint() {
  document.cookie = `${AUTH_STATE_COOKIE_NAME}=; max-age=0; path=/`;
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

beforeEach(() => {
  nav.replace.mockClear();
  nav.pathname = "/";
  auth.isAuthenticated = false;
  auth.isLoading = false;
  clearHint();
  removeAuthTokens();
});

afterEach(() => {
  cleanup();
  clearHint();
  vi.restoreAllMocks();
});

describe("a session the API rejected", () => {
  it("sends the visitor to sign-in instead of rendering a blank page", async () => {
    const { queryByText } = render(<AuthGate>protected content</AuthGate>);

    expect(queryByText("protected content")).toBeNull();
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/sign-in"));
  });

  it("waits for the hint to clear rather than fighting proxy.ts", async () => {
    // The hint still set means the session was never rejected — the server
    // could not be reached. `proxy.ts` sends /sign-in back to / while the hint
    // lives, so redirecting now would bounce the visitor between the two
    // forever.
    setHint();

    render(<AuthGate>protected content</AuthGate>);

    await settle();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("does not redirect while the session is still being checked", async () => {
    auth.isLoading = true;

    render(<AuthGate>protected content</AuthGate>);

    await settle();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("leaves public routes alone", async () => {
    nav.pathname = "/privacy-policy";

    const { getByText } = render(<AuthGate>policy text</AuthGate>);

    expect(getByText("policy text")).toBeTruthy();
    await settle();
    expect(nav.replace).not.toHaveBeenCalled();
  });
});

describe("the sign-in page", () => {
  it("still renders when React state is stale but the hint is gone", () => {
    // The axios interceptor can tear a session down without React hearing
    // about it. Hiding the form on `isAuthenticated` alone left this page
    // blank, and proxy.ts had no hint left to redirect on.
    nav.pathname = "/sign-in";
    auth.isAuthenticated = true;

    const { getByText } = render(<AuthGate>sign in form</AuthGate>);

    expect(getByText("sign in form")).toBeTruthy();
  });

  it("hides the form while a real session is still current", () => {
    nav.pathname = "/sign-in";
    auth.isAuthenticated = true;
    setHint();

    const { queryByText } = render(<AuthGate>sign in form</AuthGate>);

    expect(queryByText("sign in form")).toBeNull();
  });
});

describe("giving up on a session", () => {
  it("retracts the hint cookie proxy.ts routes on", () => {
    setHint();
    expect(hasAuthStateCookie()).toBe(true);

    removeAuthTokens();

    expect(hasAuthStateCookie()).toBe(false);
  });

  it("does not let a refresh that lands after teardown resurrect it", async () => {
    setHint();
    markAuthSession(true);

    // A refresh already in flight when the user logs out. The server answers
    // 200 and re-sets the cookies, which the browser applies regardless.
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      removeAuthTokens();
      setHint();
      return new Response("{}", { status: 200 });
    });

    const result = await refreshAccessToken();

    expect(result).toBeNull();
    expect(hasAuthStateCookie()).toBe(false);
  });
});
