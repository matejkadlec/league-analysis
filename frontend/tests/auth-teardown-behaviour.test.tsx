// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, normalizeApiError } from "@/lib/core/api";
import { queryErrorToast } from "@/lib/core/hooks";
import { AuthGate } from "@/components/auth-gate";
import {
  AUTH_STATE_COOKIE_NAME,
  AUTH_STATE_COOKIE_VALUE,
  hasAuthStateCookie,
} from "@/features/auth/utils/auth-state-cookie";

/**
 * The session hint survives every failure that is not a refusal.
 *
 * The lint rules in `eslint.config.mjs` say who may end a session, and they
 * are worth having -- but four adversarial audits have now walked past four
 * generations of that guard, because each one recognised a shape of code
 * rather than an effect. A rule that knows `cookieStore.delete(NAME)` does
 * not know `store.delete({ name: NAME })`, and no rule at all can see a
 * teardown reached through `useAuth().logout()`, because that arrives by
 * React context rather than by a module specifier.
 *
 * These tests do not care what the code looks like. They put each surface in
 * the state where a rejected session and an unreachable server are
 * indistinguishable, and assert the hint is still there afterwards -- which
 * is the actual invariant, and the thing every one of those escapes broke.
 */

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push }),
  usePathname: () => "/",
}));

const auth = vi.hoisted(() => ({
  isAuthenticated: false,
  isLoading: false,
  checkAuth: vi.fn(async () => {}),
  logout: vi.fn(async () => {}),
}));

vi.mock("@/features/auth", () => ({ useAuth: () => auth }));

function setHint() {
  document.cookie = `${AUTH_STATE_COOKIE_NAME}=${AUTH_STATE_COOKIE_VALUE}; path=/`;
}

beforeEach(() => {
  document.cookie = `${AUTH_STATE_COOKIE_NAME}=; max-age=0; path=/`;
  nav.replace.mockClear();
  nav.push.mockClear();
  auth.isAuthenticated = false;
  auth.isLoading = false;
  auth.checkAuth.mockReset();
  auth.checkAuth.mockImplementation(async () => {});
  auth.logout.mockReset();
  auth.logout.mockImplementation(async () => {});
});

afterEach(() => {
  cleanup();
  delete api.defaults.adapter;
  vi.restoreAllMocks();
  document.cookie = `${AUTH_STATE_COOKIE_NAME}=; max-age=0; path=/`;
});

describe("the axios interceptor", () => {
  it("leaves the session alone when a refresh cannot reach the server", async () => {
    // The file the original regression lived in, and the file an audit put it
    // back into while every lint rule stayed green. A 401 on a request, then
    // a refresh that fails because the API is being redeployed: nothing here
    // has been told the session is over.
    setHint();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 502 }),
    );
    api.defaults.adapter = async (config) => {
      throw Object.assign(new Error("unauthorized"), {
        isAxiosError: true,
        config,
        response: { status: 401, data: {}, headers: {}, config },
      });
    };

    await expect(api.get("/players")).rejects.toBeTruthy();

    expect(hasAuthStateCookie()).toBe(true);
  });

  it("reports a rate limit as a rate limit, not as an outage", async () => {
    // `/auth/refresh` is rate limited, uvicorn runs with --no-proxy-headers
    // and browser traffic arrives through one rewrite, so every user shares a
    // single bucket -- a 429 here is ordinary. Reporting the refresh outcome
    // without its status told those visitors to "check that the backend is
    // running" while the backend was up and answering them.
    setHint();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 429 }),
    );
    api.defaults.adapter = async (config) => {
      throw Object.assign(new Error("unauthorized"), {
        isAxiosError: true,
        config,
        response: { status: 401, data: {}, headers: {}, config },
      });
    };

    const failure = await api.get("/players").catch((error: unknown) => error);

    expect(normalizeApiError(failure).kind).toBe("rate-limit");
    expect(hasAuthStateCookie()).toBe(true);
  });

  it("stops calling an unreachable server an authentication failure", async () => {
    // The 401 that started this is true of the expired access token and of
    // nothing else, so forwarding it makes a redeploy indistinguishable from a
    // refusal. Every reader downstream then believes it: `queryErrorToast`
    // stays silent because "the auth gate already redirects on these", and the
    // gate does not redirect, because the hint is still standing. The viewer
    // gets no toast, no navigation and no error -- and the next person to
    // write `if (kind === "authentication") logout()` gets a teardown that
    // reads as correct code.
    setHint();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    api.defaults.adapter = async (config) => {
      throw Object.assign(new Error("unauthorized"), {
        isAxiosError: true,
        config,
        response: { status: 401, data: {}, headers: {}, config },
      });
    };

    const failure = await api.get("/players").catch((error: unknown) => error);

    expect(normalizeApiError(failure).kind).toBe("network");
    expect(queryErrorToast(failure)).not.toBeNull();
  });

  it("reports a redeploy as a service failure", async () => {
    setHint();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 502 }),
    );
    api.defaults.adapter = async (config) => {
      throw Object.assign(new Error("unauthorized"), {
        isAxiosError: true,
        config,
        response: { status: 401, data: {}, headers: {}, config },
      });
    };

    const failure = await api.get("/players").catch((error: unknown) => error);

    expect(normalizeApiError(failure).kind).toBe("service");
    expect(queryErrorToast(failure)).not.toBeNull();
  });

  it("still calls a refused session an authentication failure", async () => {
    // The other direction, and the reason the interceptor forwards what the
    // refresh reported rather than guessing. A server that answers 401 to the
    // refresh has refused; relabelling that would leave a dead session looking
    // transient and retryable forever.
    setHint();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 401 }),
    );
    api.defaults.adapter = async (config) => {
      throw Object.assign(new Error("unauthorized"), {
        isAxiosError: true,
        config,
        response: { status: 401, data: {}, headers: {}, config },
      });
    };

    const failure = await api.get("/players").catch((error: unknown) => error);

    expect(hasAuthStateCookie()).toBe(false);
    expect(normalizeApiError(failure).kind).toBe("authentication");
  });
});

describe("the can't-reach-the-server surface", () => {
  it("does not sign the visitor out on its own", async () => {
    // Sitting on this screen is not evidence of anything. An audit added an
    // effect here that gave up after a couple of retries and called
    // `logout()` -- which swallows an unreachable server and tears down
    // regardless, so a redeploy retracted the hint and left the refresh token
    // live. No import rule can see that call, because it comes from context.
    setHint();

    render(<AuthGate>protected content</AuthGate>);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(auth.logout).not.toHaveBeenCalled();
    expect(hasAuthStateCookie()).toBe(true);
    expect(nav.replace).not.toHaveBeenCalled();
  });
});
