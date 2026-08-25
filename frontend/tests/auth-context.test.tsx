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
    // Why the unconditional teardown is opt-in: an audit called `logout()` on
    // a timer whenever a refresh failed, reached through React context where
    // no import rule sees it, and stranded a live 30-day refresh token behind
    // a cleared hint.
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
    // `sendBeacon` returns true for *queued*, even against a refused
    // connection, so counting it as the server having answered makes the
    // opt-in above dead code. jsdom has no `sendBeacon`, so the test supplies
    // one: queueing is not answering.
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
    // The mirror-image failure: a 200 means the family is revoked, so stopping
    // there leaves the visitor on a signed-in shell whose credentials are
    // dead. Deleting `serverAnswered = response.ok` passed every test, because
    // every caller today happens to pass the flag.
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
    // `/auth/logout` has no auth dependency and cannot answer 401, so a 401
    // was minted by the maintenance Worker in front of it and nothing was
    // revoked. Reading it as "already signed out" strands a live 30-day
    // refresh token behind a retracted hint during a deploy.
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
    // Only the server can revoke; clearing cookies here hides the credential.
    // Fire-and-forget passes every other test and breaks two things: it says
    // "signed out" while a 30-day token is still spendable in this browser,
    // and it settles the promise both Sign Out buttons show a spinner from.
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

    // A real wait, pinned to the request's own deadline rather than a round
    // number. An audit gave up on the server after two seconds via
    // `Promise.race`; a test that waited one microtask, or a fixed 2.1s, waves
    // the next version of that through.
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
