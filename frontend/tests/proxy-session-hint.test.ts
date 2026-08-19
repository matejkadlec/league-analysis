// @vitest-environment node

import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { proxy } from "@/proxy";
import {
  AUTH_STATE_COOKIE_NAME,
  AUTH_STATE_COOKIE_VALUE,
} from "@/features/auth/utils/auth-state-cookie";

/**
 * The session hint has a server side, and until now nothing tested it.
 *
 * Every other guard in this codebase lives in the browser bundle: the lint
 * rules, the `SessionRefresh` type, the opt-in on `logout()`. `proxy.ts` owns
 * the same cookie, runs on every request, and is the most non-gesture context
 * in the app -- so the ninth adversarial escape was found here, and it needed
 * none of the tricks the earlier eight did. It was ordinary code: probe
 * `/auth/me` from the edge, `.catch(() => null)` the failure, redirect and
 * delete the cookie if the session no longer looks honoured. That folds "the
 * server was unreachable" back into "the session is over" -- the seventh
 * escape's bug, on a surface where the type that fixed it does not exist --
 * and it strands every visitor on every redeploy, for the whole outage, with
 * lint, typecheck and 244 tests green.
 *
 * A rule cannot catch it: the cookie's name only has to appear in the `if`,
 * not in the `delete`, and the import it needs is on the allowlist. So this
 * asserts the effect instead, which is the layer that caught escapes 7 and 8.
 * The rule for this file is simple: the edge may route on the hint, and may
 * never retract it. Only a request to the API can establish that a session is
 * over, and only `refreshAccessToken` makes that call.
 */

// `proxy` is synchronous today, and these `await`s are therefore no-ops.
// They are here because the escape this file exists to catch makes it async:
// without them the test would pass on a returned Promise, asserting nothing.
function hintedRequest(pathname: string): NextRequest {
  return new NextRequest(new URL(`http://localhost:3000${pathname}`), {
    headers: {
      cookie: `${AUTH_STATE_COOKIE_NAME}=${AUTH_STATE_COOKIE_VALUE}`,
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the edge and the session hint", () => {
  it("never retracts the hint when the API cannot be reached", async () => {
    // A redeploy. Anything here that concluded "signed out" from this would
    // retract the hint while the 30-day refresh cookie stays live and
    // HttpOnly, which JavaScript cannot reach and nothing has revoked.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("ECONNREFUSED"))),
    );

    const response = await proxy(hintedRequest("/player-overview"));

    expect(response.headers.get("set-cookie") ?? "").not.toContain(
      AUTH_STATE_COOKIE_NAME,
    );
    expect(response.headers.get("location")).toBeNull();
  });

  it("never retracts the hint on an unauthorized answer either", async () => {
    // A 401 reaching the edge did not necessarily come from the API: a
    // maintenance Worker sits on both routes. Even when it did, the browser
    // is the only place that can retry with a refresh, so the edge acting on
    // it signs out a session that was one rotation away from being fine.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("{}", { status: 401 }))),
    );

    const response = await proxy(hintedRequest("/match-history"));

    expect(response.headers.get("set-cookie") ?? "").not.toContain(
      AUTH_STATE_COOKIE_NAME,
    );
    expect(response.headers.get("location")).toBeNull();
  });

  it("still keeps a visitor without a hint off protected routes", async () => {
    // The routing the edge is for, and the reason it reads the cookie at all.
    const response = await proxy(
      new NextRequest(new URL("http://localhost:3000/player-overview")),
    );

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/sign-in",
    );
  });
});
