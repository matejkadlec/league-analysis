// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthGate, SLOW_PROBE_NOTICE_MS } from "@/components/auth-gate";
import {
  refreshAccessToken,
  removeAuthTokens,
} from "@/features/auth/utils/token-manager";
import {
  AUTH_STATE_COOKIE_NAME,
  AUTH_STATE_COOKIE_VALUE,
  clearAuthStateCookie,
  hasAuthStateCookie,
} from "@/features/auth/utils/auth-state-cookie";
import { PUBLIC_ROUTES } from "@/features/auth/utils/public-routes";
import { AUTH_PROBE_TIMEOUT_MS } from "@/features/auth/utils/login-error";
import {
  hangingFetch,
  installDrivableAbortDeadlines,
} from "./deadline-support";

const nav = vi.hoisted(() => ({ replace: vi.fn(), pathname: "/" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  usePathname: () => nav.pathname,
}));

const auth = vi.hoisted(() => ({
  isAuthenticated: false,
  isLoading: false,
  checkAuth: vi.fn(async () => {}),
  logout: vi.fn(async () => {}),
}));

vi.mock("@/features/auth", () => ({
  useAuth: () => auth,
}));

// The refusals `/auth/refresh` actually issues, body and all. A bodyless
// `new Response("{}", { status: 401 })` is not one of them, and the client
// must not take an edge-minted 403 for a refusal from this API.
function refusal(status: number, code: string): Response {
  return new Response(JSON.stringify({ detail: { code, message: code } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

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
  auth.logout.mockReset();
  auth.logout.mockImplementation(async () => {});
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
    // A hint still set means the server could not be reached, not a rejection.
    // `proxy.ts` sends /sign-in back to / while it lives, so redirecting
    // bounces forever, and rendering null leaves nothing to click.
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
    // The retry clears the hint, which changes no React state and the cookie
    // is not reactive -- so without an explicit re-read the gate shows "Can't
    // reach the server" forever over a session that is definitively gone.
    setHint();
    auth.checkAuth.mockImplementation(async () => {
      clearHint();
    });

    const { getByRole, queryByText } = render(
      <AuthGate>protected content</AuthGate>,
    );

    getByRole("button", { name: "Try again" }).click();

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/sign-in"));
    expect(queryByText("Can't reach the server")).toBeNull();
  });

  it("does not redirect while the session is still being checked", async () => {
    auth.isLoading = true;

    const { queryByText } = render(<AuthGate>protected content</AuthGate>);

    await settle();
    expect(nav.replace).not.toHaveBeenCalled();
    expect(queryByText("protected content")).toBeNull();
  });

  it("says what it is doing once the probe has run long enough to look broken", async () => {
    // This gate wraps the entire layout, so a backend that accepts the
    // connection and hangs means a white page for the full ten-second
    // deadline -- twice that when a refresh is honoured and the second hangs.
    vi.useFakeTimers();
    auth.isLoading = true;
    setHint();

    try {
      const { queryByText } = render(<AuthGate>protected content</AuthGate>);

      // Against a literal, not the constant under test: advancing
      // `SLOW_PROBE_NOTICE_MS - 1` only proves the component honours its own
      // value, so a one-millisecond delay would pass by construction.
      expect(SLOW_PROBE_NOTICE_MS).toBeGreaterThanOrEqual(300);

      await act(async () => {
        vi.advanceTimersByTime(Math.max(0, 300 - 1));
      });
      expect(queryByText("Checking your session…")).toBeNull();

      await act(async () => {
        vi.advanceTimersByTime(SLOW_PROBE_NOTICE_MS);
      });

      expect(queryByText("Checking your session…")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  // Every entry, not a sample of one: asserting `/privacy-policy` alone lets
  // a dropped `/cookie-policy` pass the whole suite. The list is shared with
  // `proxy.ts`, so this sweeps whatever it holds.
  it.each(PUBLIC_ROUTES)("leaves the public route %s alone", async (route) => {
    nav.pathname = route;

    const { getByText } = render(<AuthGate>policy text</AuthGate>);

    expect(getByText("policy text")).toBeTruthy();
    await settle();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("still sends a signed-out visitor away from a protected route", async () => {
    // The other direction: a list that grew to cover everything would pass
    // the sweep above and let anyone read any page signed out.
    nav.pathname = "/players";

    const { queryByText } = render(<AuthGate>protected content</AuthGate>);

    await settle();
    expect(nav.replace).toHaveBeenCalledWith("/sign-in");
    expect(queryByText("protected content")).toBeNull();
  });
});

describe("the can't-reach-the-server surface", () => {
  it("says a retry is running, and refuses to stack another", async () => {
    // Both actions can take the full ten-second deadline, and this surface
    // exists for exactly the server that will take it. With nothing moving,
    // the visitor reads the button as dead and stacks another probe.
    setHint();
    let release: (() => void) | null = null;
    auth.checkAuth.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = () => resolve();
        }),
    );

    const { getByRole, queryByRole } = render(
      <AuthGate>protected content</AuthGate>,
    );

    await act(async () => {
      getByRole("button", { name: "Try again" }).click();
    });

    expect(queryByRole("button", { name: "Try again" })).toBeNull();
    expect(getByRole("button", { name: "Checking…" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(getByRole("button", { name: "Sign out" })).toHaveProperty(
      "disabled",
      true,
    );

    // The stacking the title names, actually attempted.
    await act(async () => {
      getByRole("button", { name: "Checking…" }).click();
    });
    expect(auth.checkAuth).toHaveBeenCalledTimes(1);

    await act(async () => {
      release?.();
    });
    expect(getByRole("button", { name: "Try again" })).toHaveProperty(
      "disabled",
      false,
    );
  });

  it("offers a way out when retrying will never work", async () => {
    // A persistent 500 on one account takes this branch forever: `proxy.ts`
    // sends /sign-in back here while the hint lives, and the sidebar's Sign
    // Out is not drawn for an unauthenticated visitor.
    setHint();
    auth.logout.mockImplementation(async () => {
      clearHint();
    });

    const { getByRole, queryByText } = render(
      <AuthGate>protected content</AuthGate>,
    );

    getByRole("button", { name: "Sign out" }).click();

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/sign-in"));
    expect(queryByText("Can't reach the server")).toBeNull();
  });

  it("stops drawing the signed-in shell the moment the session is given up", async () => {
    // The cookie is not reactive and the interceptor's teardown changes no
    // React state, so a gate that only read it at render time kept the whole
    // signed-in UI on screen over an API refusing every call.
    auth.isAuthenticated = true;
    setHint();

    const { getByText, queryByText } = render(
      <AuthGate>protected content</AuthGate>,
    );
    expect(getByText("protected content")).toBeTruthy();

    await act(async () => {
      removeAuthTokens();
    });

    expect(queryByText("protected content")).toBeNull();
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
    // here and fails in production: a visitor on /player-overview would delete
    // a page-scoped cookie while the "/" hint survived its own delete.
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

  it("reads the hint as present only for the value the server writes", async () => {
    // `proxy.ts` compares against AUTH_STATE_COOKIE_VALUE exactly. A name-only
    // match leaves every test green while the edge and the browser silently
    // disagree about who is signed in.
    document.cookie = `${AUTH_STATE_COOKIE_NAME}=something-else; path=/`;

    expect(hasAuthStateCookie()).toBe(false);
  });

  it("does not take an edge challenge for a refusal", async () => {
    // Cloudflare fronts these routes: a challenge answers with 403 and an HTML
    // body the origin never sees. Taking that for a refusal retracts the hint
    // and strands a 30-day token nothing revoked.
    setHint();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html><title>Access denied</title></html>", {
        status: 403,
        headers: { "content-type": "text/html" },
      }),
    );

    const result = await refreshAccessToken();

    expect(result).toEqual({ outcome: "unreachable" });
    expect(hasAuthStateCookie()).toBe(true);
  });

  it("still recognises a refusal wrapped in a problem+json envelope", async () => {
    // Why the media type is matched loosely: errors can come back as RFC 9457
    // `application/problem+json`, and a strict `application/json` match stops
    // every genuine sign-out.
    setHint();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          detail: { code: "INVALID_REFRESH_TOKEN", message: "gone" },
          status: 401,
        }),
        { status: 401, headers: { "content-type": "application/problem+json" } },
      ),
    );

    const result = await refreshAccessToken();

    expect(result).toEqual({ outcome: "refused" });
    expect(hasAuthStateCookie()).toBe(false);
  });

  it("does not take a refusal-shaped body served as HTML for a refusal", async () => {
    // The content-type check, on its own. A challenge page is free to embed
    // anything, and a body is only this API's answer if it arrives as this
    // API's media type.
    setHint();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ detail: { code: "INVALID_REFRESH_TOKEN" } }),
        { status: 401, headers: { "content-type": "text/html" } },
      ),
    );

    const result = await refreshAccessToken();

    expect(result).toEqual({ outcome: "unreachable" });
    expect(hasAuthStateCookie()).toBe(true);
  });

  it("does not treat a 403 about something else as the end of the session", async () => {
    // A 403 means "not authorized for this", not "your session is over". An
    // `email_verified` gate on the dependency every protected route shares
    // would sign out visitors whose refresh token is still live.
    setHint();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      refusal(403, "EMAIL_NOT_VERIFIED"),
    );

    const result = await refreshAccessToken();

    expect(result).toEqual({ outcome: "unreachable" });
    expect(hasAuthStateCookie()).toBe(true);
  });

  it("keeps the deadline short enough to be a deadline", async () => {
    // Every other deadline assertion is relative to this constant, so nothing
    // bounds it above: raising it to ten minutes leaves the suite green while
    // a hung backend holds the visitor on a spinner for that long.
    expect(AUTH_PROBE_TIMEOUT_MS).toBeLessThanOrEqual(15_000);
  });

  it("gives up on the refresh at the deadline, not never", async () => {
    // Without a deadline a backend that accepts the connection and hangs
    // strands the caller. Asserted as an effect: checking only that the signal
    // is an `AbortSignal` stays green with the deadline deleted.
    setHint();
    vi.useFakeTimers();
    const restoreDeadlines = installDrivableAbortDeadlines();
    try {
      vi.spyOn(globalThis, "fetch").mockImplementation(hangingFetch());

      let settled = false;
      const pending = refreshAccessToken().then((result) => {
        settled = true;
        return result;
      });

      await vi.advanceTimersByTimeAsync(AUTH_PROBE_TIMEOUT_MS - 100);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(200);
      await expect(pending).resolves.toEqual({ outcome: "unreachable" });
      // Nothing was learned, so nothing is torn down.
      expect(hasAuthStateCookie()).toBe(true);
    } finally {
      restoreDeadlines();
      vi.useRealTimers();
    }
  });

  it("gives up on the post-teardown logout at the deadline, not never", async () => {
    // `refreshInFlight` clears only once the post-teardown logout settles, so
    // without a deadline one hung logout leaves every later refresh awaiting a
    // promise that never settles: token refresh silently dead for the tab.
    setHint();
    vi.useFakeTimers();
    const restoreDeadlines = installDrivableAbortDeadlines();
    try {
      const hang = hangingFetch();
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        if (String(input).includes("/auth/refresh")) {
          removeAuthTokens(); // Torn down while this was in flight.
          setHint();
          return new Response("{}", { status: 200 });
        }
        return await hang(input, init);
      });

      let settled = false;
      const pending = refreshAccessToken().then((result) => {
        settled = true;
        return result;
      });

      await vi.advanceTimersByTimeAsync(AUTH_PROBE_TIMEOUT_MS - 100);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(200);
      await expect(pending).resolves.toEqual({ outcome: "refused" });
    } finally {
      restoreDeadlines();
      vi.useRealTimers();
    }
  });

  it("clears the hint when the server rejects the refresh", async () => {
    // For the reported visitor -- hint cookie, no usable tokens -- this
    // rejection is what retracts the hint, which is what lets the gate
    // redirect instead of rendering nothing.
    setHint();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      refusal(401, "INVALID_REFRESH_TOKEN"),
    );

    const result = await refreshAccessToken();

    expect(result).toEqual({ outcome: "refused" });
    expect(hasAuthStateCookie()).toBe(false);
  });

  it("ends the session when the account is deactivated", async () => {
    // `/auth/refresh` answers 403 ACCOUNT_INACTIVE after revoking every token
    // server-side. Nothing else feeds a 403 to a refresh, so narrowing the
    // refusal check to `=== 401` strands the visitor for good.
    setHint();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      refusal(403, "ACCOUNT_INACTIVE"),
    );

    const result = await refreshAccessToken();

    expect(result).toEqual({ outcome: "refused" });
    expect(hasAuthStateCookie()).toBe(false);
  });

  it("keeps the session when the server is merely unavailable", async () => {
    // A 502 is a redeploy, not a rejection. Tearing down here signed people
    // out mid-deploy with a valid refresh cookie still in the jar.
    setHint();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 502 }),
    );

    const result = await refreshAccessToken();

    // Reported as what it was, status and all. A caller that cannot tell this
    // from a refusal is one `if (!result) logout()` away from signing the
    // visitor out over a redeploy.
    expect(result).toEqual({ outcome: "unavailable", status: 502 });
    expect(hasAuthStateCookie()).toBe(true);
  });

  it("keeps the session when the refresh never reaches the server", async () => {
    setHint();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));

    const result = await refreshAccessToken();

    expect(result).toEqual({ outcome: "unreachable" });
    expect(hasAuthStateCookie()).toBe(true);
  });

  it("never answers a refresh with a falsy value", async () => {
    // Nothing stops someone writing `if (!(await refreshAccessToken()))
    // logout()`; every outcome is truthy, so that check is dead code rather
    // than a teardown over a redeploy. Telling the two apart means `outcome`.
    setHint();
    const answers: unknown[] = [];
    for (const respond of [
      () => Promise.resolve(refusal(401, "INVALID_REFRESH_TOKEN")),
      () => Promise.resolve(new Response("{}", { status: 502 })),
      () => Promise.resolve(new Response("{}", { status: 429 })),
      () => Promise.reject(new Error("offline")),
    ]) {
      setHint();
      vi.spyOn(globalThis, "fetch").mockImplementation(respond);
      answers.push(await refreshAccessToken());
    }

    expect(answers).toHaveLength(4);
    for (const answer of answers) {
      expect(answer).toBeTruthy();
    }
  });

  it("does not tear down a session that started after it was rejected", async () => {
    // A shared machine: A signs out while a refresh of A's session is still
    // in flight, B signs in, then the stale refresh comes back 401. Acting on
    // it here would delete B's hint and bounce B back to the sign-in page.
    setHint();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      removeAuthTokens(); // A signs out mid-flight.
      setHint();
      return refusal(401, "INVALID_REFRESH_TOKEN");
    });

    const result = await refreshAccessToken();

    // Reported as nothing learned, not as `unavailable` carrying the 401.
    // `normalizeApiError` reads 401 back as `kind: "authentication"`, so
    // passing the status on hands B somebody else's refusal as their own.
    expect(result).toEqual({ outcome: "unreachable" });
    expect(hasAuthStateCookie()).toBe(true);
  });

  it("does not let a refresh that lands after teardown resurrect it", async () => {
    // Also why this logout is not skipped when somebody signed in since the
    // teardown: /auth/refresh re-sets all three cookies under the same names
    // and path, so the browser has already replaced their jar.
    setHint();

    // A refresh already in flight when the user logs out. The server answers
    // 200 and re-sets the cookies, which the browser applies regardless.
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes("/auth/refresh")) {
        removeAuthTokens();
        setHint();
      }
      return new Response("{}", { status: 200 });
    });

    const result = await refreshAccessToken();

    expect(result).toEqual({ outcome: "refused" });
    expect(hasAuthStateCookie()).toBe(false);
    // Clearing the hint only hides the rotated token; the new refresh cookie
    // is HttpOnly, so the session has to be ended server-side.
    const logoutCall = calls.find((call) => call.url.includes("/auth/logout"));
    // The shape, not just the URL. As a GET this is a 405 and as a request
    // without cookies the server resolves nobody -- both revoke nothing while
    // leaving "a call happened" perfectly green.
    expect(logoutCall?.init).toEqual(
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    // That this logout also has a working deadline is asserted as an effect
    // in "gives up on the post-teardown logout at the deadline, not never";
    // `toBeInstanceOf(AbortSignal)` here was green with the deadline deleted.
  });
});
