// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    // The code axios itself pairs with a 4xx. Reporting ERR_BAD_RESPONSE for
    // every unavailable status tells a consumer reading `.code` that a rate
    // limit came back as a server fault.
    expect((failure as { code?: string }).code).toBe("ERR_BAD_REQUEST");
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
    // The refusal this API actually issues, code and all: a bare 401 with no
    // body is what a challenge in front of the API sends, and the client no
    // longer takes that for a refusal.
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
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not sign the visitor out on its own", async () => {
    // Sitting on this screen is not evidence of anything. An audit added an
    // effect here that gave up after a couple of retries and called
    // `logout()` -- which swallows an unreachable server and tears down
    // regardless, so a redeploy retracted the hint and left the refresh token
    // live. No import rule can see that call, because it comes from context.
    setHint();

    render(<AuthGate>protected content</AuthGate>);

    // Long enough that a teardown on a timer cannot simply outwait the
    // assertion. Fifty milliseconds passed a retry-then-give-up effect that
    // fired a second later.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(auth.logout).not.toHaveBeenCalled();
    expect(hasAuthStateCookie()).toBe(true);
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("still signs the visitor out when they press the button here", async () => {
    // The counterpart, and the reason `logout` takes a flag rather than
    // simply never tearing down: this screen exists for the server that is
    // not answering, so its Sign out button is the one caller that must act
    // anyway. Dropping the flag here -- one word, invisible to every lint
    // rule, since the call arrives through context -- leaves the visitor
    // pressing a button that does nothing at all, on the one surface whose
    // whole purpose is to be the way out.
    setHint();

    render(<AuthGate>protected content</AuthGate>);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    });

    expect(auth.logout).toHaveBeenCalledWith({
      evenIfTheServerCannotBeReached: true,
    });
  });
});

describe("cookie consent", () => {
  // The one file allowed to write cookies by hand, and the gap the lint
  // config's own header names and then delegates here -- a delegation nothing
  // enforced until this test existed. An audit made the consent sweep clear
  // *cookies* as well as localStorage, keeping a list of necessary names that
  // did not include the session hint. That reads as the safe direction, is
  // legal in this file by design, and runs from a mount effect whenever the
  // stored consent is missing or its version is stale -- so bumping
  // COOKIE_CONSENT_VERSION would have signed out every visitor on their next
  // page load, with the server perfectly healthy.
  // Three cases, not one. A later audit split the mount effect's condition --
  // "missing or stale" became two branches, which reads as the more careful
  // version -- and put the sweep on the stale half, which nothing exercised.
  // Bumping COOKIE_CONSENT_VERSION would then have signed out every returning
  // visitor on their next page load. So each branch that can reach a sweep is
  // named here: no consent, stale consent, and the button that writes one.
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
    setHint();
    document.cookie = "league_analysis_cookie_consent=; max-age=0; path=/";

    render(<CookieConsentManager />);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Accept necessary" }));
    });

    expect(hasAuthStateCookie()).toBe(true);
  });
});
