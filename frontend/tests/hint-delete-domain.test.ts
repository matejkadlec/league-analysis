// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://dev.leagueanalysis.gg/" }

import { afterEach, describe, expect, it } from "vitest";

import {
  AUTH_STATE_COOKIE_NAME,
  clearAuthStateCookie,
  hasAuthStateCookie,
} from "@/features/auth/utils/auth-state-cookie";

/**
 * The hint has to die under whatever domain it was born with.
 *
 * The backend writes this cookie in Python and the browser deletes it in
 * TypeScript, and nothing checks that the two agree. Three of the four
 * attributes are not part of a cookie's identity and Path is `/` on both
 * sides -- but Domain is, and today it is absent on both sides only by luck.
 * The day someone shares the session across `dev.` and `www.` -- a careful
 * change, symmetric on the backend, with its own tests -- a host-only delete
 * writes a cookie that expires instantly and matches nothing, while the real
 * hint sits there untouched. A refused refresh sends no Set-Cookie at all, so
 * this delete is the only thing that retracts the hint on the path that
 * matters, and one that survives leaves the visitor on "Can't reach the
 * server" forever with `proxy.ts` still admitting them.
 *
 * Run against a real cookie jar on a real host rather than against the
 * delete's text, because the claim is that the browser stops reporting it.
 */
afterEach(() => {
  for (const entry of document.cookie.split("; ")) {
    const name = entry.split("=")[0];
    if (name) {
      document.cookie = `${name}=; max-age=0; path=/`;
      document.cookie = `${name}=; max-age=0; path=/; domain=leagueanalysis.gg`;
    }
  }
});

describe("retracting the session hint", () => {
  it("clears a host-only hint", () => {
    document.cookie = `${AUTH_STATE_COOKIE_NAME}=1; path=/`;
    expect(hasAuthStateCookie()).toBe(true);

    clearAuthStateCookie();

    expect(hasAuthStateCookie()).toBe(false);
    expect(document.cookie).not.toContain(AUTH_STATE_COOKIE_NAME);
  });

  it("clears a hint scoped to a parent domain", () => {
    document.cookie = `${AUTH_STATE_COOKIE_NAME}=1; path=/; domain=leagueanalysis.gg`;
    expect(hasAuthStateCookie()).toBe(true);

    clearAuthStateCookie();

    expect(hasAuthStateCookie()).toBe(false);
    expect(document.cookie).not.toContain(AUTH_STATE_COOKIE_NAME);
  });
});
