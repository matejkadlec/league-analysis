// @vitest-environment jsdom

import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getAccessToken,
  refreshAccessToken,
  removeAuthTokens,
  setAuthTokens,
  routerPush,
} = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  refreshAccessToken: vi.fn(),
  removeAuthTokens: vi.fn(),
  setAuthTokens: vi.fn(),
  routerPush: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

vi.mock("../features/auth/utils/token-manager", () => ({
  getAccessToken,
  refreshAccessToken,
  removeAuthTokens,
  setAuthTokens,
}));

import { AuthProvider, useAuth } from "../features/auth/context/auth-context";
import { LOGIN_REQUEST_TIMEOUT_MS } from "../features/auth/utils/login-error";
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
    getAccessToken.mockReset();
    getAccessToken.mockReturnValue(null);
    refreshAccessToken.mockReset();
    refreshAccessToken.mockResolvedValue({ outcome: "unreachable" });
    removeAuthTokens.mockReset();
    setAuthTokens.mockReset();
    routerPush.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function renderAuthProvider() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AuthProbe onLogin={(nextLogin) => (login = nextLogin)} />
        </AuthProvider>
      </QueryClientProvider>,
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
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
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

    await expect(loginError).resolves.toMatchObject({ code: "REQUEST_TIMEOUT" });
  });

  it("keeps the timeout active while parsing an error login response", async () => {
    vi.useFakeTimers();
    const abortError = Object.assign(new Error("The operation was aborted"), {
      code: 20,
      name: "AbortError",
    });
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
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

    await expect(loginError).resolves.toMatchObject({ code: "REQUEST_TIMEOUT" });
  });

  it("clears the timeout after the login response body has been parsed", async () => {
    vi.useFakeTimers();
    const request = { signal: null as AbortSignal | null };
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
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
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const startLogin = renderAuthProvider();

    await expect(
      startLogin({ email: "user@example.com", password: "secret-password" }),
    ).resolves.toBeUndefined();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOGIN_REQUEST_TIMEOUT_MS);
    });

    expect(request.signal?.aborted).toBe(false);
    expect(setAuthTokens).toHaveBeenCalled();
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
  });

  it("waits for the server before reporting the session over", async () => {
    // Only the server can revoke; clearing cookies here merely hides the
    // credential. Reverting this to fire-and-forget passes every other test
    // in the suite, and it breaks two things at once: it reports "signed out"
    // while a 30-day refresh token is still live and spendable in this
    // browser -- on a shared machine, by the next person -- and it settles
    // the promise both Sign Out buttons drive their pending state from, so
    // the spinner vanishes while the request is still in flight.
    removeAuthTokens.mockReset();
    routerPush.mockReset();
    getAccessToken.mockReturnValue(null);
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

    let logout: AuthContextType["logout"] | undefined;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <LogoutProbe onLogout={(next) => (logout = next)} />
        </AuthProvider>
      </QueryClientProvider>,
    );
    if (!logout) {
      throw new Error("Auth logout callback was not initialized");
    }

    // Let the mount probe settle first; it has its own teardown rules and
    // this test is only about what `logout` does.
    await act(async () => {
      await Promise.resolve();
    });
    removeAuthTokens.mockReset();
    routerPush.mockReset();

    let settled = false;
    const pending = logout().then(() => {
      settled = true;
    });

    // Real timers and a real wait, not one microtask. An audit gave up on the
    // server after two seconds via `Promise.race` and this test stayed green,
    // because it had already finished asserting -- restoring the exact failure
    // its own comment names.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2100));
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
      expect.objectContaining({ method: "POST" }),
    );
  });
});
