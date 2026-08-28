// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://dev.leagueanalysis.gg/" }

import { afterEach, describe, expect, it } from "vitest";

import {
  AUTH_STATE_COOKIE_NAME,
  clearAuthStateCookie,
  hasAuthStateCookie,
} from "@/lib/session/auth-state-cookie";

/**
 * The hint has to die under whatever domain it was born with. Domain is part
 * of a cookie's identity; the day the session is shared across hosts, a
 * host-only delete matches nothing and leaves the visitor stranded.
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
