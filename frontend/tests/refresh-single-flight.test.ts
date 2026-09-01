// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { refreshAccessToken } from "@/lib/session/token-manager";
import {
  AUTH_STATE_COOKIE_NAME,
  AUTH_STATE_COOKIE_VALUE,
} from "@/lib/session/auth-state-cookie";

/**
 * Without the shared promise each parallel 401 replays the same refresh cookie,
 * and the server reads the second replay as reuse and revokes the chain.
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
  it("sends the session cookies it exists to rotate", async () => {
    // The refresh token is HttpOnly, so without `credentials: "include"` every
    // refresh reaches the server bare and each tab dies at token expiry.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));

    expect(await refreshAccessToken()).toEqual({ outcome: "refreshed" });

    const [, init] = fetchSpy.mock.calls[0] ?? [];
    expect(init?.credentials).toBe("include");
  });
});
