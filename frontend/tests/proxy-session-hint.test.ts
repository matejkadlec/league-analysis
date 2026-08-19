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

function plainRequest(pathname: string): NextRequest {
  return new NextRequest(new URL(`http://localhost:3000${pathname}`));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the edge and the session hint", () => {
  // Every response this file can produce, asserted whole.
  //
  // Two earlier versions of this test checked one response each, and both
  // were walked past. Naming forbidden channels missed `Clear-Site-Data` on a
  // `rewrite`; asserting the envelope for a single path missed a teardown
  // that simply excluded that path; and spying on `globalThis.fetch` missed a
  // probe made through axios, which is already a dependency here. The common
  // shape of all three is a test that samples. So this samples nothing: every
  // routing case the edge has, compared against its complete header set. A
  // teardown that reaches any of them fails, whatever channel it uses and
  // however it decided -- because the decision is not what is being watched.
  const cases: {
    what: string;
    path: string;
    hint: boolean;
    status: number;
    headers: [string, string][];
  }[] = [
    {
      what: "a hinted visitor on a protected route",
      path: "/player-overview",
      hint: true,
      status: 200,
      headers: [["x-middleware-next", "1"]],
    },
    {
      what: "a hinted visitor on another protected route",
      path: "/match-history",
      hint: true,
      status: 200,
      headers: [["x-middleware-next", "1"]],
    },
    {
      what: "a hinted visitor on the home page",
      path: "/",
      hint: true,
      status: 200,
      headers: [["x-middleware-next", "1"]],
    },
    {
      what: "a hinted visitor on a public route",
      path: "/privacy-policy",
      hint: true,
      status: 200,
      headers: [["x-middleware-next", "1"]],
    },
    {
      // Routing on the hint, which is all the edge may do with it.
      what: "a hinted visitor arriving at the sign-in page",
      path: "/sign-in",
      hint: true,
      status: 307,
      headers: [["location", "http://localhost:3000/"]],
    },
    {
      what: "a visitor with no hint on a protected route",
      path: "/player-overview",
      hint: false,
      status: 307,
      headers: [["location", "http://localhost:3000/sign-in"]],
    },
    {
      what: "a visitor with no hint on a public route",
      path: "/privacy-policy",
      hint: false,
      status: 200,
      headers: [["x-middleware-next", "1"]],
    },
  ];

  it.each(cases)("passes $what through untouched", async (testCase) => {
    const response = await proxy(
      testCase.hint ? hintedRequest(testCase.path) : plainRequest(testCase.path),
    );

    expect([...response.headers.entries()]).toEqual(testCase.headers);
    expect(response.status).toBe(testCase.status);
  });

  it("never asks the API whether a session is still good", async () => {
    // A cheaper early signal than the table above, and strictly weaker: it
    // only sees `globalThis.fetch` at call time, so an imported client or a
    // module-scope alias walks past it. The table is the guarantee; this
    // names the mistake, because an edge that probes has already lost. It
    // cannot tell a refusal from an outage, and cannot retry with a refresh
    // -- that is `refreshAccessToken`'s job, in the browser, where the
    // distinction exists.
    const fetchSpy = vi.fn(() => Promise.reject(new Error("ECONNREFUSED")));
    vi.stubGlobal("fetch", fetchSpy);

    await proxy(hintedRequest("/player-overview"));
    await proxy(plainRequest("/"));

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
