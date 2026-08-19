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
 *
 * The assertion is deliberately upstream of the teardown rather than on it. A
 * first version checked two named channels -- no `Set-Cookie` naming the hint,
 * no redirect -- and a later audit walked straight past both with
 * `Clear-Site-Data: "cookies"`, which is a third channel and strictly more
 * destructive: it takes the HttpOnly refresh token too, while the row stays
 * live server-side. Naming channels is the enumeration that failed six times
 * over in the lint rules. So what is asserted is that the edge never asks the
 * API anything: with no answer there is nothing to be wrong about, and every
 * teardown channel is closed at once, including the ones nobody has thought
 * of. If the edge ever genuinely needs to make a request, this test should be
 * rewritten rather than relaxed, because that request is the whole hazard.
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
  it("never asks the API whether a session is still good", async () => {
    // The edge cannot tell a refusal from an outage: it gets one answer, or
    // none, and no way to retry with a refresh -- that is the browser's job,
    // and `refreshAccessToken` is where the distinction lives. So an edge that
    // probes has already lost, whatever it does with the answer. Asserting the
    // absence of the question closes every channel the answer could be acted
    // on through.
    const fetchSpy = vi.fn(() => Promise.reject(new Error("ECONNREFUSED")));
    vi.stubGlobal("fetch", fetchSpy);

    await proxy(hintedRequest("/player-overview"));
    await proxy(hintedRequest("/match-history"));
    await proxy(new NextRequest(new URL("http://localhost:3000/")));

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("passes a hinted request through untouched", async () => {
    // No header that retracts anything, whatever it is called. `Set-Cookie`
    // was the first channel an audit reached for and `Clear-Site-Data` the
    // second, so this asserts the whole envelope rather than a list of names.
    const response = await proxy(hintedRequest("/player-overview"));

    // Positive, not a denylist: this is exactly what `NextResponse.next()`
    // produces. A `rewrite` swaps in `x-middleware-rewrite` and carries no
    // `location`, so listing forbidden headers missed it -- the same
    // enumerate-the-spellings mistake the lint rules made six times.
    expect([...response.headers.entries()]).toEqual([["x-middleware-next", "1"]]);
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
