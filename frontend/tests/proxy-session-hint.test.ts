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
} from "@/lib/session/auth-state-cookie";

// The edge may route on the hint but never retract it: only a request to the API
// tells a refusal from an outage, and the edge cannot make one.

function hintedRequest(pathname: string): NextRequest {
  return new NextRequest(new URL(`http://localhost:3000${pathname}`), {
    headers: {
      cookie: `${AUTH_STATE_COOKIE_NAME}=${AUTH_STATE_COOKIE_VALUE}`,
    },
  });
}

// Read from `app/` rather than listed by hand, so a route that exists is a route
// this asserts about.
const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "app");

function discoverRoutes(): string[] {
  const routes: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && /^page\.(tsx|ts|jsx|js)$/.test(entry.name)) {
        routes.push(prefix === "" ? "/" : prefix);
      }
      if (entry.isDirectory() && !entry.name.startsWith("_")) {
        // A route group contributes no URL segment, so recurse without appending it.
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

// A request shape is as much a case as a path is: a teardown gated on
// `sec-fetch-dest: document` passes a table of bare requests without ever running.
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
  // Compared against the complete header set: sampling one header cannot see the
  // decision the edge actually made.
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
      // The matcher excludes only `_next/static`, `_next/image` and the favicon, so
      // every other dotted path lands in this branch.
      what: "a hinted visitor loading a static asset",
      path: "/background.jpg",
      hint: true,
      status: 200,
      headers: [["x-middleware-next", "1"]],
    },
    {
      // The row that makes `isStaticOrInternal` load-bearing; the hinted rows cannot
      // see it, because a hint passes through either way.
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
      // The client-error beacon is not a page: without this branch a signed-out crash
      // 307s the report away and the frontend container never sees it.
      what: "a visitor with no hint posting a client error report",
      path: "/client-error-report",
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
      // The edge compares the value, not just the name: a name-only check admits a
      // signed-out visitor and bounces them between `/` and `/sign-in`.
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

  it.each(cases)("passes $what through untouched", (testCase) => {
    const response = proxy(
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
  ])("passes %s through untouched", (_what, path, hint) => {
    const response = proxy(navigationRequest(path, hint));

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

  it.each(routes)("passes a hinted visitor on %s through untouched", (route) => {
    const response = proxy(hintedRequest(route));

    const expected: [string, string][] =
      route === "/sign-in"
        ? [["location", "http://localhost:3000/"]]
        : [["x-middleware-next", "1"]];
    expect([...response.headers.entries()]).toEqual(expected);
  });

  it.each(routes)("routes a visitor with no hint on %s without retracting anything", (route) => {
    const response = proxy(plainRequest(route));

    const expected: [string, string][] = PUBLIC_ROUTES.has(route)
      ? [["x-middleware-next", "1"]]
      : [["location", "http://localhost:3000/sign-in"]];
    expect([...response.headers.entries()]).toEqual(expected);
  });

  it("has no other edge entrypoint to hide in", () => {
    // Next runs whichever of `proxy`/`middleware`, root or `src/`, exists; this file
    // asserts about `@/proxy` alone, so a second entrypoint would be uncovered.
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    // Matches `EDGE_FILES` in oxlint.config.mts; a `proxy.tsx` beside `proxy.ts`
    // wins Next's discovery loop, so the edge Next runs stops being this import.
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

  it("never asks the API whether a session is still good", () => {
    // Weaker than the table above: the spy sees only `globalThis.fetch` at call
    // time, so an imported client would walk past it.
    const fetchSpy = vi.fn<typeof fetch>(() =>
      Promise.reject(new Error("ECONNREFUSED")),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const hinted = proxy(hintedRequest("/player-overview"));
    const plain = proxy(plainRequest("/"));

    expect([...hinted.headers.entries()]).toEqual([["x-middleware-next", "1"]]);
    expect([...plain.headers.entries()]).toEqual([
      ["location", "http://localhost:3000/sign-in"],
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
