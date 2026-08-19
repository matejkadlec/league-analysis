// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/core/api";
import { AuthGate } from "@/components/auth-gate";
import {
  AUTH_STATE_COOKIE_NAME,
  AUTH_STATE_COOKIE_VALUE,
  hasAuthStateCookie,
} from "@/features/auth/utils/auth-state-cookie";
import { markAuthSession } from "@/features/auth/utils/token-manager";

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
    markAuthSession(true);
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
