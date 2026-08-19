// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { refreshAccessToken } from "@/features/auth/utils/token-manager";
import {
  AUTH_STATE_COOKIE_NAME,
  AUTH_STATE_COOKIE_VALUE,
} from "@/features/auth/utils/auth-state-cookie";

/**
 * One refresh per tab, however many 401s arrive at once.
 *
 * The app fires many react-query calls in parallel, so the moment the
 * 30-minute access token expires several 401s land together and each reaches
 * the axios interceptor. Without the shared promise in `token-manager.ts`,
 * each one POSTs `/auth/refresh` carrying the *same* refresh cookie -- the
 * browser composed them all before any rotation landed. The first rotates;
 * every other is a replay of a token that is now revoked, which the server
 * reads as reuse and answers by revoking the whole family, on every device.
 *
 * The client is right to end the session at that point, because the server
 * really did refuse. That is what makes this so quiet: no guard here is
 * violated, nothing lies, and an ordinary page load after lunch signs the
 * visitor out everywhere with nothing they could have done differently.
 *
 * Deleting the guard left all 320 tests green.
 */

beforeEach(() => {
  document.cookie = `${AUTH_STATE_COOKIE_NAME}=${AUTH_STATE_COOKIE_VALUE}; path=/`;
});

afterEach(() => {
  document.cookie = `${AUTH_STATE_COOKIE_NAME}=; max-age=0; path=/`;
  vi.restoreAllMocks();
});

describe("concurrent refreshes in one tab", () => {
  it("sends one request and gives every caller its answer", async () => {
    const answered: ((value: Response) => void)[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          answered.push(resolve);
        }),
    );

    // Started before the first settles, which is the whole point: three
    // queries 401ing within the same tick is the ordinary case, not the race.
    const all = Promise.all([
      refreshAccessToken(),
      refreshAccessToken(),
      refreshAccessToken(),
    ]);
    await Promise.resolve();
    for (const answer of answered) {
      answer(new Response("{}", { status: 200 }));
    }

    expect(await all).toEqual([
      { outcome: "refreshed" },
      { outcome: "refreshed" },
      { outcome: "refreshed" },
    ]);
    // Two would be one replay of a revoked token: reuse, and the server
    // revokes every session this person has.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
