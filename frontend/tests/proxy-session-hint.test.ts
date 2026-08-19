// @vitest-environment node

import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

// Read from `app/` rather than listed by hand. Every earlier version of this
// table enumerated paths, and an audit walked past each one by picking a path
// it had not thought to include -- `/settings`, in the last case, with the
// header name assembled from fragments so no selector saw a literal. A route
// that exists is a route this asserts about, without anyone remembering to
// add it.
const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "app");

function discoverRoutes(): string[] {
  const routes: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && /^page\.(tsx|ts|jsx|js)$/.test(entry.name)) {
        routes.push(prefix === "" ? "/" : prefix);
      }
      if (entry.isDirectory() && !entry.name.startsWith("_")) {
        // A route group contributes no URL segment, so recurse without
        // appending it -- skipping the directory outright hid every route
        // inside it, which is the same hole in a different costume.
        const segment = entry.name.startsWith("(") ? "" : `/${entry.name}`;
        walk(join(dir, entry.name), `${prefix}${segment}`);
      }
    }
  };
  walk(APP_DIR, "");
  return routes.sort();
}

const PUBLIC_ROUTES = new Set([
  "/sign-in",
  "/join-us",
  "/privacy-policy",
  "/cookie-policy",
  "/license",
]);

function plainRequest(pathname: string): NextRequest {
  return new NextRequest(new URL(`http://localhost:3000${pathname}`));
}

// The headers a browser actually sends on a click. An audit gated its
// teardown on `sec-fetch-dest: document` -- a sensible-looking way to avoid
// probing on every prefetch -- and the whole table passed, because every
// request in it was bare. A request shape is as much a case as a path is.
function navigationRequest(pathname: string, hint: boolean): NextRequest {
  return new NextRequest(new URL(`http://localhost:3000${pathname}`), {
    headers: {
      ...(hint
        ? { cookie: `${AUTH_STATE_COOKIE_NAME}=${AUTH_STATE_COOKIE_VALUE}` }
        : {}),
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "same-origin",
      accept: "text/html,application/xhtml+xml",
      "user-agent": "Mozilla/5.0",
    },
  });
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
    cookie?: string;
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
      // The first branch in the function, and the one taken most often: the
      // matcher only excludes `_next/static`, `_next/image` and the favicon,
      // so every dotted path -- `/background.jpg`, referenced by the global
      // stylesheet, on every page load -- lands here.
      what: "a hinted visitor loading a static asset",
      path: "/background.jpg",
      hint: true,
      status: 200,
      headers: [["x-middleware-next", "1"]],
    },
    {
      // Without a hint, and this is the case that makes the branch
      // load-bearing: delete `isStaticOrInternal` and this asset answers a
      // 307 to /sign-in, on every signed-out page load. Three hinted rows
      // could not see that, because a hinted request passes through either
      // way.
      what: "a visitor with no hint loading a static asset",
      path: "/background.jpg",
      hint: false,
      status: 200,
      headers: [["x-middleware-next", "1"]],
    },
    {
      what: "a visitor with no hint on an internal Next.js path",
      path: "/_next/static/chunk.js",
      hint: false,
      status: 200,
      headers: [["x-middleware-next", "1"]],
    },
    {
      what: "a hinted visitor on an API path",
      path: "/api/v1/auth/me",
      hint: true,
      status: 200,
      headers: [["x-middleware-next", "1"]],
    },
    {
      what: "a hinted visitor on a sign-in subpath",
      path: "/sign-in/callback",
      hint: true,
      status: 307,
      headers: [["location", "http://localhost:3000/"]],
    },
    {
      what: "a hinted visitor on a public subpath",
      path: "/privacy-policy/changes",
      hint: true,
      status: 200,
      headers: [["x-middleware-next", "1"]],
    },
    {
      // The edge compares the value, not just the name. Relaxing that to a
      // name check leaves the edge admitting a visitor the browser reports as
      // signed out, which is the `/` <-> `/sign-in` bounce the whole fix is
      // about -- and it left every test green, because nothing ever sent a
      // cookie with the wrong value.
      what: "a visitor carrying a hint cookie with some other value",
      path: "/player-overview",
      hint: false,
      cookie: `${AUTH_STATE_COOKIE_NAME}=someone-elses-value`,
      status: 307,
      headers: [["location", "http://localhost:3000/sign-in"]],
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
      testCase.cookie
        ? new NextRequest(new URL(`http://localhost:3000${testCase.path}`), {
            headers: { cookie: testCase.cookie },
          })
        : testCase.hint
          ? hintedRequest(testCase.path)
          : plainRequest(testCase.path),
    );

    expect([...response.headers.entries()]).toEqual(testCase.headers);
    expect(response.status).toBe(testCase.status);
  });

  it.each([
    ["a hinted visitor clicking through to a protected route", "/player-overview", true],
    ["a hinted visitor clicking through to the home page", "/", true],
  ])("passes %s through untouched", async (_what, path, hint) => {
    const response = await proxy(navigationRequest(path, hint));

    expect([...response.headers.entries()]).toEqual([["x-middleware-next", "1"]]);
    expect(response.status).toBe(200);
  });

  const routes = discoverRoutes();

  it("found the app's routes to assert about", () => {
    // If this ever reads zero, every generated case below silently asserts
    // nothing -- the failure mode of a table that builds itself.
    expect(routes.length).toBeGreaterThan(5);
    expect(routes).toContain("/");
    expect(routes).toContain("/settings");
  });

  it.each(routes)("passes a hinted visitor on %s through untouched", async (route) => {
    const response = await proxy(hintedRequest(route));

    if (route === "/sign-in") {
      expect([...response.headers.entries()]).toEqual([
        ["location", "http://localhost:3000/"],
      ]);
      return;
    }
    expect([...response.headers.entries()]).toEqual([["x-middleware-next", "1"]]);
  });

  it.each(routes)("routes a visitor with no hint on %s without retracting anything", async (route) => {
    const response = await proxy(plainRequest(route));

    const expected: [string, string][] = PUBLIC_ROUTES.has(route)
      ? [["x-middleware-next", "1"]]
      : [["location", "http://localhost:3000/sign-in"]];
    expect([...response.headers.entries()]).toEqual(expected);
  });

  it("has no other edge entrypoint to hide in", () => {
    // Next accepts `proxy`, `middleware`, `src/proxy` and `src/middleware`,
    // and runs whichever exists. Everything asserted here is asserted about
    // `@/proxy` alone, and the lint rules name files too -- so a second
    // entrypoint would be an edge with no rules and no coverage at all.
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    // Every name Next can resolve, matching the lint block's file list. The
    // one that actually shadows is `proxy.tsx`: candidates are sorted so the
    // preferred extension comes last and overrides, `pageExtensions` puts tsx
    // first in preference, and the edge bundle then contains `proxy.tsx` with
    // `proxy.ts` nowhere in it -- while this whole file, which imports
    // `@/proxy` through Vite, keeps asserting about the source Next no longer
    // runs.
    const names = ["proxy", "middleware"];
    const extensions = ["ts", "tsx", "js", "jsx"];
    const candidates = names.flatMap((name) =>
      extensions.flatMap((extension) => [
        `${name}.${extension}`,
        `src/${name}.${extension}`,
      ]),
    ).filter((candidate) => candidate !== "proxy.ts");

    for (const candidate of candidates) {
      expect(existsSync(join(root, candidate))).toBe(false);
    }
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
