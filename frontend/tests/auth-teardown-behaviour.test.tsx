// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, normalizeApiError } from "@/lib/core/http/api";
import { queryErrorToast } from "@/lib/core/hooks";
import { AuthGate } from "@/components/auth-gate";
import type { AuthContextType } from "@/features/auth/types";
import {
  AUTH_STATE_COOKIE_NAME,
  AUTH_STATE_COOKIE_VALUE,
  clearAuthStateCookie,
  hasAuthStateCookie,
} from "@/lib/session/auth-state-cookie";

// The session hint survives every failure that is not a refusal; lint sees
// shapes, so these assert the effect where refusal and outage look alike.

type Router = ReturnType<typeof import("next/navigation").useRouter>;

const nav = vi.hoisted(() => ({
  replace: vi.fn<Router["replace"]>(),
  push: vi.fn<Router["push"]>(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push }),
  usePathname: () => "/",
}));

const auth = vi.hoisted(() => ({
  isAuthenticated: false,
  isLoading: false,
  checkAuth: vi.fn<AuthContextType["checkAuth"]>(async () => {}),
  logout: vi.fn<AuthContextType["logout"]>(async () => {}),
}));

vi.mock("@/features/auth", () => ({ useAuth: () => auth }));

import { CookieConsentManager } from "@/features/cookie-consent";

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
    // A 401 on a request, then a refresh that fails because the API is being
    // redeployed: nothing here has been told the session is over.
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
    // Browser traffic reaches `/auth/refresh` through one rewrite with
    // --no-proxy-headers, so every user shares a bucket and a 429 is ordinary.
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
    // The code axios pairs with a 4xx: ERR_BAD_RESPONSE would tell a consumer
    // reading `.code` that a rate limit was a server fault.
    expect((failure as { code?: string }).code).toBe("ERR_BAD_REQUEST");
    expect(hasAuthStateCookie()).toBe(true);
  });

  it("stops calling an unreachable server an authentication failure", async () => {
    // The 401 is true of the expired access token only, so forwarding it makes
    // a redeploy read as a refusal: no toast, no navigation, no error.
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

  it("retries a 401 once, never in a loop", async () => {
    // `_retry` is the only thing stopping re-entry: a 401 surviving a refresh
    // loops, rotating the token against a 20/minute site-wide bucket.
    setHint();
    let refreshes = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      refreshes += 1;
      return new Response("{}", { status: 200 });
    });
    let requests = 0;
    api.defaults.adapter = async (config) => {
      requests += 1;
      // A ceiling, so an unguarded interceptor terminates and fails an
      // assertion instead of spinning until the worker dies.
      if (requests > 5) {
        return { status: 200, data: {}, headers: {}, config, statusText: "" };
      }
      throw Object.assign(new Error("unauthorized"), {
        isAxiosError: true,
        config,
        response: { status: 401, data: {}, headers: {}, config },
      });
    };

    await expect(api.get("/players")).rejects.toBeTruthy();

    // The original, and one retry after the refresh. Nothing more: without
    // the guard this runs to the ceiling and resolves.
    expect(requests).toBe(2);
    expect(refreshes).toBe(1);
  });

  it("still calls a refused session an authentication failure", async () => {
    // The interceptor forwards what the refresh reported: relabelling a refusal
    // leaves a dead session looking transient and retryable forever.
    setHint();
    // The refusal this API actually issues, code and all: a bare 401 is what a
    // challenge in front of the API sends, and no longer counts as a refusal.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          detail: { code: "INVALID_REFRESH_TOKEN", message: "expired" },
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      ),
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
  beforeEach(() => {
    // `shouldAdvanceTime` because user-event's own inter-event waits are real
    // timers: a frozen clock never delivers them and the click never lands.
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not sign the visitor out on its own", async () => {
    // Sitting on this screen is evidence of nothing: a give-up effect calling
    // `logout()` retracts the hint on a redeploy and leaves the token live.
    setHint();

    render(<AuthGate>protected content</AuthGate>);

    // Long enough that a teardown on a timer cannot outwait the assertion.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(auth.logout).not.toHaveBeenCalled();
    expect(hasAuthStateCookie()).toBe(true);
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("still signs the visitor out when they press the button here", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    // Why `logout` takes a flag: this screen exists for the server that is not
    // answering, so its Sign out is the one caller that must act anyway.
    setHint();
    // The teardown the real `logout` performs, so the button is observable by
    // what it releases the visitor from rather than by the mock it called.
    auth.logout.mockImplementation(async () => {
      clearAuthStateCookie();
    });

    render(<AuthGate>protected content</AuthGate>);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(auth.logout).toHaveBeenCalledWith({
      evenIfTheServerCannotBeReached: true,
    });
    expect(screen.queryByText("Can't reach the server")).toBeNull();
  });
});

describe("cookie consent", () => {
  // The one file allowed to write cookies by hand: a sweep whose "necessary"
  // list omits the session hint signs everyone out on a version bump.

  // Each branch that can reach a sweep, not one: no consent, stale consent,
  // and the button that writes one.
  it.each([
    ["no consent at all", ""],
    ["consent given under an earlier policy version", "v0|all|2026-01-01T00:00:00.000Z"],
  ])("does not take the session hint with it: %s", async (_case, value) => {
    setHint();
    document.cookie = value
      ? `league_analysis_cookie_consent=${encodeURIComponent(value)}; path=/`
      : "league_analysis_cookie_consent=; max-age=0; path=/";

    render(<CookieConsentManager />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(hasAuthStateCookie()).toBe(true);
  });

  it("does not take the session hint with it when a choice is saved", async () => {
    const user = userEvent.setup();
    setHint();
    document.cookie = "league_analysis_cookie_consent=; max-age=0; path=/";

    render(<CookieConsentManager />);
    await act(async () => {
      await Promise.resolve();
    });
    await user.click(screen.getByRole("button", { name: "Accept necessary" }));

    expect(hasAuthStateCookie()).toBe(true);
  });
});
