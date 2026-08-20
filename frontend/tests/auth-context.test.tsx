// @vitest-environment jsdom

import { useEffect } from "react";
import { act, cleanup } from "@testing-library/react";

import { renderWithQueryClient } from "./render-support";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { refreshAccessToken, removeAuthTokens, routerPush } = vi.hoisted(() => ({
  refreshAccessToken: vi.fn(),
  removeAuthTokens: vi.fn(),
  routerPush: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

vi.mock("../features/auth/utils/token-manager", () => ({
  refreshAccessToken,
  removeAuthTokens,
}));

import { AuthProvider, useAuth } from "../features/auth/context/auth-context";
import {
  AUTH_PROBE_TIMEOUT_MS,
  LOGIN_REQUEST_TIMEOUT_MS,
} from "../features/auth/utils/login-error";
import type { AuthContextType } from "../features/auth/types";

function AuthProbe({
  onLogin,
}: {
  onLogin: (login: AuthContextType["login"]) => void;
}) {
  const { login } = useAuth();

  useEffect(() => {
    onLogin(login);
  }, [login, onLogin]);

  return null;
}

describe("AuthProvider login timeout", () => {
  let login: AuthContextType["login"] | undefined;

  beforeEach(() => {
    login = undefined;
    refreshAccessToken.mockReset();
    refreshAccessToken.mockResolvedValue({ outcome: "unreachable" });
    removeAuthTokens.mockReset();
    routerPush.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function renderAuthProvider() {
    renderWithQueryClient(
      <AuthProvider>
        <AuthProbe onLogin={(nextLogin) => (login = nextLogin)} />
      </AuthProvider>,
    );

    if (!login) {
      throw new Error("Auth login callback was not initialized");
    }

    return login;
  }

  it("keeps the timeout active while parsing a successful login response", async () => {
    vi.useFakeTimers();
    const abortError = Object.assign(new Error("The operation was aborted"), {
      code: 20,
      name: "AbortError",
    });
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          new Promise((_, reject) => {
            init?.signal?.addEventListener("abort", () => reject(abortError), {
              once: true,
            });
          }),
      } as Response),
    );
    vi.stubGlobal("fetch", fetchMock);

    const startLogin = renderAuthProvider();
    const loginPromise = startLogin({
      email: "user@example.com",
      password: "secret-password",
    });
    const loginError = loginPromise.catch((error: unknown) => error);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOGIN_REQUEST_TIMEOUT_MS);
    });

    await expect(loginError).resolves.toMatchObject({
      code: "REQUEST_TIMEOUT",
    });
  });

  it("keeps the timeout active while parsing an error login response", async () => {
    vi.useFakeTimers();
    const abortError = Object.assign(new Error("The operation was aborted"), {
      code: 20,
      name: "AbortError",
    });
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve({
        ok: false,
        status: 401,
        json: () =>
          new Promise((_, reject) => {
            init?.signal?.addEventListener("abort", () => reject(abortError), {
              once: true,
            });
          }),
      } as Response),
    );
    vi.stubGlobal("fetch", fetchMock);

    const startLogin = renderAuthProvider();
    const loginPromise = startLogin({
      email: "user@example.com",
      password: "secret-password",
    });
    const loginError = loginPromise.catch((error: unknown) => error);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOGIN_REQUEST_TIMEOUT_MS);
    });

    await expect(loginError).resolves.toMatchObject({
      code: "REQUEST_TIMEOUT",
    });
  });

  it("clears the timeout after the login response body has been parsed", async () => {
    vi.useFakeTimers();
    const request = { signal: null as AbortSignal | null };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/auth/login")) {
        request.signal = init?.signal ?? null;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              access_token: "access-token",
              refresh_token: "refresh-token",
              token_type: "bearer",
              expires_in_seconds: 900,
              refresh_expires_in_seconds: 3600,
            }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            id: 1,
            email: "user@example.com",
            display_name: "User",
            is_active: true,
            is_admin: false,
            email_verified: true,
            email_verified_at: null,
            last_login: null,
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
          }),
      } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    const startLogin = renderAuthProvider();

    await expect(
      startLogin({ email: "user@example.com", password: "secret-password" }),
    ).resolves.toBeUndefined();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOGIN_REQUEST_TIMEOUT_MS);
    });

    expect(request.signal?.aborted).toBe(false);
  });
});

function LogoutProbe({
  onLogout,
}: {
  onLogout: (logout: AuthContextType["logout"]) => void;
}) {
  const { logout } = useAuth();

  useEffect(() => {
    onLogout(logout);
  }, [logout, onLogout]);

  return null;
}

describe("AuthProvider logout", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function renderLogout(): AuthContextType["logout"] {
    let logout: AuthContextType["logout"] | undefined;
    renderWithQueryClient(
      <AuthProvider>
        <LogoutProbe onLogout={(next) => (logout = next)} />
      </AuthProvider>,
    );
    if (!logout) {
      throw new Error("Auth logout callback was not initialized");
    }
    return logout;
  }

  it("changes nothing when an automatic logout cannot reach the server", async () => {
    // The eighth escape, and the reason the unconditional teardown is now
    // opt-in. An audit mounted a keep-alive that called `logout()` on a timer
    // whenever a refresh failed -- reached through React context, so no import
    // rule sees it, and every lint rule stayed green while it cleared the hint
    // over an outage and stranded a live 30-day refresh token.
    //
    // A caller that writes plain `logout()`, which is what a machine will
    // write, now sends the request and leaves everything alone if it never
    // arrives.
    refreshAccessToken.mockResolvedValue({ outcome: "unreachable" });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );

    const logout = renderLogout();
    await act(async () => {
      await Promise.resolve();
    });
    removeAuthTokens.mockReset();
    routerPush.mockReset();

    await act(async () => {
      await logout();
    });

    expect(removeAuthTokens).not.toHaveBeenCalled();
    expect(routerPush).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/auth/logout"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("changes nothing when a beacon is queued instead of a request answered", async () => {
    // The escape a later audit wrote, and it reads as an improvement: catch
    // the offline case, hand the logout to `navigator.sendBeacon` so the
    // browser retries it after the tab closes, and count that as the server
    // having answered. It is not one. `sendBeacon` returns true for *queued*
    // -- against a refused connection it still returns true -- so
    // `serverAnswered` becomes true unconditionally, the opt-in above turns
    // into dead code, and plain `logout()` is back to tearing the session
    // down over every blip with the refresh token live and unrevoked.
    //
    // jsdom has no `sendBeacon`, which is why the whole suite stayed green
    // for that edit. So the test supplies one: the invariant is about the
    // effect, not the API -- queueing is not answering, whatever the return
    // value says.
    refreshAccessToken.mockResolvedValue({ outcome: "unreachable" });
    const sendBeacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", {
      value: sendBeacon,
      configurable: true,
      writable: true,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );

    try {
      const logout = renderLogout();
      await act(async () => {
        await Promise.resolve();
      });
      removeAuthTokens.mockReset();
      routerPush.mockReset();

      await act(async () => {
        await logout();
      });

      expect(removeAuthTokens).not.toHaveBeenCalled();
      expect(routerPush).not.toHaveBeenCalled();
    } finally {
      delete (navigator as { sendBeacon?: unknown }).sendBeacon;
    }
  });

  it("tears down without the flag when the server did answer", async () => {
    // The default is "changed nothing" only when the request never arrived.
    // A 200 means the server revoked the family, and stopping there would
    // leave the visitor on a signed-in shell whose credentials are already
    // dead -- the mirror-image failure, and a one-line hole: deleting
    // `serverAnswered = response.ok` passed all 320 tests, because every
    // caller today happens to pass the flag.
    refreshAccessToken.mockResolvedValue({ outcome: "unreachable" });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, status: 200 } as Response)),
    );

    const logout = renderLogout();
    await act(async () => {
      await Promise.resolve();
    });
    removeAuthTokens.mockReset();
    routerPush.mockReset();

    await act(async () => {
      await logout();
    });

    expect(removeAuthTokens).toHaveBeenCalled();
    expect(routerPush).toHaveBeenCalledWith("/sign-in");
  });

  it("changes nothing when an edge answers 401 for an automatic logout", async () => {
    // A maintenance Worker sits in front of this route, and `/auth/logout`
    // itself has no auth dependency and cannot answer 401. So a 401 here was
    // minted by something that never reached the backend, and nothing was
    // revoked -- treating it as "already signed out" would strand a live
    // 30-day refresh token behind a retracted hint during a deploy.
    refreshAccessToken.mockResolvedValue({ outcome: "unreachable" });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: false, status: 401 } as Response)),
    );

    const logout = renderLogout();
    await act(async () => {
      await Promise.resolve();
    });
    removeAuthTokens.mockReset();
    routerPush.mockReset();

    await act(async () => {
      await logout();
    });

    expect(removeAuthTokens).not.toHaveBeenCalled();
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("still signs the visitor out when they asked and the server is down", async () => {
    // The other half: for a person who just pressed the button, being left
    // staring at an account they asked to leave is the worse failure. Both
    // call sites that pass this flag are a control under someone's finger.
    refreshAccessToken.mockResolvedValue({ outcome: "unreachable" });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );

    const logout = renderLogout();
    await act(async () => {
      await Promise.resolve();
    });
    removeAuthTokens.mockReset();
    routerPush.mockReset();

    await act(async () => {
      await logout({ evenIfTheServerCannotBeReached: true });
    });

    expect(removeAuthTokens).toHaveBeenCalled();
    expect(routerPush).toHaveBeenCalledWith("/sign-in");
  });

  it("waits for the server before reporting the session over", async () => {
    // Only the server can revoke; clearing cookies here merely hides the
    // credential. Reverting this to fire-and-forget passes every other test
    // in the suite, and it breaks two things at once: it reports "signed out"
    // while a 30-day refresh token is still live and spendable in this
    // browser -- on a shared machine, by the next person -- and it settles
    // the promise both Sign Out buttons drive their pending state from, so
    // the spinner vanishes while the request is still in flight.
    vi.useFakeTimers();
    removeAuthTokens.mockReset();
    routerPush.mockReset();
    refreshAccessToken.mockResolvedValue({ outcome: "unreachable" });

    let releaseServer: (() => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            releaseServer = () =>
              resolve({ ok: true, status: 200 } as Response);
          }),
      ),
    );

    const logout = renderLogout();

    // Let the mount probe settle first; it has its own teardown rules and
    // this test is only about what `logout` does.
    await act(async () => {
      await Promise.resolve();
    });
    removeAuthTokens.mockReset();
    routerPush.mockReset();

    let settled = false;
    const pending = logout({ evenIfTheServerCannotBeReached: true }).then(
      () => {
        settled = true;
      },
    );

    // Real timers and a real wait, not one microtask. An audit gave up on the
    // server after two seconds via `Promise.race` and this test stayed green,
    // because it had already finished asserting -- restoring the exact failure
    // its own comment names.
    // Pinned to the request's own deadline rather than to a round number. An
    // audit gave up after two seconds via `Promise.race` and an earlier
    // version of this test, which waited 2.1s, would have caught that one and
    // waved a three-second version through.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTH_PROBE_TIMEOUT_MS - 100);
    });

    expect(settled).toBe(false);
    expect(removeAuthTokens).not.toHaveBeenCalled();
    expect(routerPush).not.toHaveBeenCalled();

    await act(async () => {
      releaseServer?.();
      await pending;
    });

    expect(settled).toBe(true);
    expect(removeAuthTokens).toHaveBeenCalled();
    expect(routerPush).toHaveBeenCalledWith("/sign-in");
    // The mock ignores its arguments, so without this the request could be a
    // GET -- 405, nothing revoked -- and every assertion above still holds.
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/auth/logout"),
      // The mock ignores its arguments, so without these the request could be
      // a GET (405, nothing revoked) or carry no cookies (the server resolves
      // nobody, nothing revoked) and every assertion above still holds.
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      }),
    );
  });
});
