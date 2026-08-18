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
  clearAuthStateCookie,
  hasAuthStateCookie,
} from "@/features/auth/utils/auth-state-cookie";

const nav = vi.hoisted(() => ({ replace: vi.fn(), pathname: "/" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  usePathname: () => nav.pathname,
}));

const auth = vi.hoisted(() => ({
  isAuthenticated: false,
  isLoading: false,
  checkAuth: vi.fn(async () => {}),
}));

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
  auth.checkAuth.mockReset();
  auth.checkAuth.mockImplementation(async () => {});
  clearHint();
  removeAuthTokens();
});

afterEach(() => {
  cleanup();
  clearHint();
  vi.restoreAllMocks();
});

describe("a session that is genuinely current", () => {
  it("draws the protected page", () => {
    // The one case with no assertion anywhere before this: every other test
    // here checks that something is NOT drawn, so the whole suite stayed
    // green against a gate that rendered nothing for everyone.
    auth.isAuthenticated = true;
    setHint();

    const { getByText } = render(<AuthGate>protected content</AuthGate>);

    expect(getByText("protected content")).toBeTruthy();
  });
});

describe("a session the API rejected", () => {
  it("sends the visitor to sign-in instead of rendering a blank page", async () => {
    const { queryByText } = render(<AuthGate>protected content</AuthGate>);

    expect(queryByText("protected content")).toBeNull();
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/sign-in"));
  });

  it("offers a retry instead of a blank page when the server is unreachable", async () => {
    // Hint still set means the session was never rejected — the server could
    // not be reached. `proxy.ts` sends /sign-in back to / while the hint
    // lives, so redirecting would bounce the visitor forever. Rendering null
    // was the original bug: no route change, nothing to click, and the only
    // thing that re-checks runs on mount.
    setHint();

    const { getByRole, getByText } = render(
      <AuthGate>protected content</AuthGate>,
    );

    await settle();
    expect(nav.replace).not.toHaveBeenCalled();
    expect(getByText("Can't reach the server")).toBeTruthy();

    getByRole("button", { name: "Try again" }).click();
    expect(auth.checkAuth).toHaveBeenCalled();
  });

  it("does not draw protected content when the hint is gone but state is stale", async () => {
    // The interceptor can tear a session down without the context hearing.
    // Rendering on `isAuthenticated` alone left the signed-in UI up over an
    // API refusing every call.
    auth.isAuthenticated = true;

    const { queryByText } = render(<AuthGate>protected content</AuthGate>);

    expect(queryByText("protected content")).toBeNull();
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/sign-in"));
  });

  it("escapes the retry surface once a retry proves the session is dead", async () => {
    // The retry re-checks and the check clears the hint — but that changes no
    // React state, and the cookie is not reactive, so without an explicit
    // re-read the gate would keep showing "Can't reach the server" forever
    // over a session that is definitively gone. Reloading was the only exit,
    // and nothing on screen said so.
    setHint();
    auth.checkAuth.mockImplementation(async () => {
      clearHint();
    });

    const { getByRole } = render(<AuthGate>protected content</AuthGate>);

    getByRole("button", { name: "Try again" }).click();

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/sign-in"));
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

  it("renders the form for a signed-out visitor carrying a stale hint", () => {
    // Pins the conjunction rather than either half. Deciding on the hint
    // alone blanks the sign-in page for exactly the visitor who needs it --
    // the one whose session died but whose cookie outlived it.
    nav.pathname = "/sign-in";
    auth.isAuthenticated = false;
    setHint();

    const { getByText } = render(<AuthGate>sign in form</AuthGate>);

    expect(getByText("sign in form")).toBeTruthy();
  });
});

describe("giving up on a session", () => {
  it("deletes with the path the server wrote, not the current page's", () => {
    // jsdom serves every test from "/", so a delete that omits path=/ passes
    // here and fails in production: a visitor on /player-overview would
    // delete a page-scoped cookie while the "/" hint survived its own
    // delete -- the stranded state, now permanent.
    const written: string[] = [];
    const original = Object.getOwnPropertyDescriptor(
      Document.prototype,
      "cookie",
    );
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => "",
      set: (value: string) => written.push(value),
    });

    try {
      clearAuthStateCookie();
    } finally {
      delete (document as unknown as Record<string, unknown>).cookie;
      if (original) {
        Object.defineProperty(Document.prototype, "cookie", original);
      }
    }

    expect(written).toHaveLength(1);
    expect(written[0]).toContain("path=/");
    expect(written[0]).toContain("max-age=0");
    expect(written[0]).toContain("SameSite=Lax");
  });

  it("retracts the hint cookie proxy.ts routes on", () => {
    setHint();
    expect(hasAuthStateCookie()).toBe(true);

    removeAuthTokens();

    expect(hasAuthStateCookie()).toBe(false);
  });

  it("clears the hint when the server rejects the refresh", async () => {
    // The load-bearing line of the whole fix. For the reported visitor --
    // hint cookie, no usable tokens -- this rejection is what retracts the
    // hint, which is what lets the gate redirect instead of rendering
    // nothing. Deleting it used to pass the entire suite.
    setHint();
    markAuthSession(true);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 401 }),
    );

    const result = await refreshAccessToken();

    expect(result).toBeNull();
    expect(hasAuthStateCookie()).toBe(false);
  });

  it("keeps the session when the server is merely unavailable", async () => {
    // A 502 is a redeploy, not a rejection. Tearing down here signed people
    // out mid-deploy with a valid refresh cookie still in the jar.
    setHint();
    markAuthSession(true);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 502 }),
    );

    const result = await refreshAccessToken();

    expect(result).toBeNull();
    expect(hasAuthStateCookie()).toBe(true);
  });

  it("keeps the session when the refresh never reaches the server", async () => {
    setHint();
    markAuthSession(true);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));

    const result = await refreshAccessToken();

    expect(result).toBeNull();
    expect(hasAuthStateCookie()).toBe(true);
  });

  it("does not let a refresh that lands after teardown resurrect it", async () => {
    setHint();
    markAuthSession(true);

    // A refresh already in flight when the user logs out. The server answers
    // 200 and re-sets the cookies, which the browser applies regardless.
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/auth/refresh")) {
        removeAuthTokens();
        setHint();
      }
      return new Response("{}", { status: 200 });
    });

    const result = await refreshAccessToken();

    expect(result).toBeNull();
    expect(hasAuthStateCookie()).toBe(false);
    // Clearing the hint only hides the rotated token; the new refresh cookie
    // is HttpOnly, so the session has to be ended server-side.
    expect(calls.some((url) => url.includes("/auth/logout"))).toBe(true);
  });
});
