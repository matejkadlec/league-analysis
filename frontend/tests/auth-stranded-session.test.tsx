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

  it("says what it is doing once the probe has run long enough to look broken", async () => {
    // This gate wraps the entire layout, so a backend that accepts the
    // connection and hangs used to mean a white page -- no header, no
    // spinner, nothing to read -- for the full ten-second deadline, and twice
    // that when a refresh is honoured and the second probe hangs too. That is
    // the reported symptom, merely time-boxed.
    vi.useFakeTimers();
    auth.isLoading = true;
    setHint();

    try {
      const { queryByText } = render(<AuthGate>protected content</AuthGate>);

      // Advanced to just short of the delay, not merely "not yet advanced".
      // Under fake timers any pending timeout satisfies the latter, so a
      // delay of zero would pass it -- and a message that flashes on every
      // healthy page load is the regression this half exists to catch.
      // Against a literal, not against the constant under test. Advancing
      // `SLOW_PROBE_NOTICE_MS - 1` only proves the component honours its own
      // value, so every value passes by construction -- including one
      // millisecond, which is exactly the flash on every healthy page load
      // this half exists to prevent. `Math.max` also keeps a mistaken
      // constant failing as an assertion rather than as "Negative ticks are
      // not supported", which reads like a broken test.
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

  it("leaves public routes alone", async () => {
    nav.pathname = "/privacy-policy";

    const { getByText } = render(<AuthGate>policy text</AuthGate>);

    expect(getByText("policy text")).toBeTruthy();
    await settle();
    expect(nav.replace).not.toHaveBeenCalled();
  });
});

describe("the can't-reach-the-server surface", () => {
  it("says a retry is running, and refuses to stack another", async () => {
    // Both actions can take the full ten-second deadline, and this surface
    // exists for exactly the server that will take it. With nothing on screen
    // moving, the visitor reads the button as dead and clicks again, stacking
    // another probe each time.
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
    // A persistent 500 on this one account takes the same branch forever:
    // `proxy.ts` sends /sign-in back here while the hint lives, and the
    // sidebar's Sign Out button is not drawn for a visitor who is not
    // authenticated. Without this control the only escape is deleting the
    // cookie by hand in devtools.
    setHint();
    auth.logout.mockImplementation(async () => {
      clearHint();
    });

    const { getByRole } = render(<AuthGate>protected content</AuthGate>);

    getByRole("button", { name: "Sign out" }).click();

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/sign-in"));
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

  it("gives up on the refresh at the deadline, not never", async () => {
    // Without a deadline a backend that accepts the connection and hangs
    // strands the caller exactly as a probe that never settles would. Asserted
    // as an effect: this used to check only that the signal was an
    // `AbortSignal`, which stayed green with the deadline deleted.
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
    // The refresh that lands after a teardown asks the server to end the
    // rotated session, and `refreshInFlight` is only cleared once that
    // settles. Without a deadline on it, one hung logout leaves every later
    // refresh awaiting a promise that never settles: token refresh silently
    // dead for the whole tab.
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
    // The load-bearing line of the whole fix. For the reported visitor --
    // hint cookie, no usable tokens -- this rejection is what retracts the
    // hint, which is what lets the gate redirect instead of rendering
    // nothing. Deleting it used to pass the entire suite.
    setHint();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 401 }),
    );

    const result = await refreshAccessToken();

    expect(result).toEqual({ outcome: "refused" });
    expect(hasAuthStateCookie()).toBe(false);
  });

  it("ends the session when the account is deactivated", async () => {
    // `/auth/refresh` answers 403 ACCOUNT_INACTIVE and revokes every refresh
    // token server-side before it does. Nothing else in the suite feeds a 403
    // to a refresh, so narrowing the refusal check to `=== 401` used to pass
    // the entire gate -- and it leaves the visitor on "Can't reach the server"
    // for good, with retry taking the same branch every time and a session
    // the backend has already destroyed.
    setHint();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 403 }),
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
    // visitor out over a redeploy, and that is the shape an audit used to walk
    // past every guard in the repo with.
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
    // The seventh escape, and the only one that got past both the lint rules
    // and the behavioural tests. This function is the one import every file in
    // the repo is allowed to make, and it used to return a falsy value for a
    // rejected session and for a server it never reached alike. So
    // `if (!(await refreshAccessToken())) logout()` read as correct code,
    // was invisible to any import rule, and signed people out over a redeploy
    // -- an audit shipped exactly that as a proactive keep-alive.
    //
    // Nothing can stop someone writing that check. This makes it inert when
    // they do: every outcome is truthy, so the naive test is dead code rather
    // than a teardown, and telling a refusal from an outage requires reading
    // `outcome`, which is the decision this whole design turns on.
    setHint();
    const answers: unknown[] = [];
    for (const respond of [
      () => Promise.resolve(new Response("{}", { status: 401 })),
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
    // in flight, B signs in, then the stale refresh finally comes back 401.
    // Acting on it here would delete B's hint and bounce B -- who just signed
    // in successfully -- straight back to the sign-in page.
    setHint();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      removeAuthTokens(); // A signs out mid-flight.
      setHint();
      return new Response("{}", { status: 401 });
    });

    const result = await refreshAccessToken();

    // Reported as nothing learned, not as `unavailable` carrying the 401.
    // `api.ts` re-encodes a status into a response and `normalizeApiError`
    // reads 401 back as `kind: "authentication"`, so passing the status on
    // would hand B somebody else's refusal as their own.
    expect(result).toEqual({ outcome: "unreachable" });
    expect(hasAuthStateCookie()).toBe(true);
  });

  it("does not let a refresh that lands after teardown resurrect it", async () => {
    // Also the guard against the tempting mistake of skipping this logout
    // when somebody has signed in since the teardown. /auth/refresh answers
    // 200 with Set-Cookie for all three cookies under the same names and
    // path, so by the time this runs the browser has already replaced their
    // jar with the rotated session -- skipping would leave a shell with
    // their name on it sending somebody else's credentials.
    setHint();

    // A refresh already in flight when the user logs out. The server answers
    // 200 and re-sets the cookies, which the browser applies regardless.
    const calls: { url: string; signal: AbortSignal | null | undefined }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      calls.push({ url, signal: init?.signal });
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
    expect(logoutCall).toBeTruthy();
    // That this logout also has a working deadline is asserted as an effect
    // in "gives up on the post-teardown logout at the deadline, not never";
    // `toBeInstanceOf(AbortSignal)` here was green with the deadline deleted.
  });
});
