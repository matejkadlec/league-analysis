import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const APP_DIRECTORY = join(process.cwd(), "app");
const SIDEBAR_NAV = readFileSync(
  join(process.cwd(), "components/sidebar-nav.tsx"),
  "utf8",
);

// The root route is the shell itself rather than a navigation target, and the
// rest are PUUID-preserving compatibility redirects kept for old links. The
// test below proves each one still only redirects, so this list cannot quietly
// become a way to ship an unreachable page.
const NOT_NAVIGATION_TARGETS = new Set([
  "/",
  "/my-profile",
  "/playstyle-analysis",
  "/tracked-players",
]);

// Routes a signed-out visitor is meant to reach. Everything else in app/ that
// is not a redirect has to be wrapped, and the test below is written so that
// forgetting is the failing case: a new page is protected unless someone adds
// it here on purpose.
const PUBLIC_ROUTES = new Set([
  "/cookie-policy",
  "/join-us",
  "/license",
  "/privacy-policy",
  "/sign-in",
]);

/** Every route in app/ that renders a page, as its URL path. */
function pageRoutes(directory: string, route = ""): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      // Route groups — (auth) — organise files without appearing in the URL.
      const segment = /^\(.*\)$/.test(entry.name) ? "" : `/${entry.name}`;
      return pageRoutes(join(directory, entry.name), `${route}${segment}`);
    }
    return entry.name === "page.tsx" ? [route || "/"] : [];
  });
}

describe("page navigation contract", () => {
  it("registers every destination page in the sidebar", () => {
    const unregistered = pageRoutes(APP_DIRECTORY).filter(
      (route) =>
        !NOT_NAVIGATION_TARGETS.has(route) &&
        !SIDEBAR_NAV.includes(`"${route}"`),
    );

    expect(unregistered).toEqual([]);
  });

  it("keeps every page that is not public behind ProtectedRoute", () => {
    // The admin flag on /jobs was guarded and the wrapper itself was not, so
    // deleting `<ProtectedRoute>` from any of the other six pages typechecked,
    // linted, and passed all 451 tests. What ships then is a page that renders
    // its own chrome to a signed-out visitor and fills it with 401s -- the same
    // shape as the stranded-session blank page, arrived at from the other side.
    //
    // This is asserted against the source text rather than by rendering,
    // because the thing being pinned is the wrapper's presence in the tree, and
    // a render test proves it only for whichever page it renders.
    const unprotected = pageRoutes(APP_DIRECTORY).filter((route) => {
      if (PUBLIC_ROUTES.has(route)) return false;
      const page = readFileSync(
        join(APP_DIRECTORY, route === "/" ? "" : route, "page.tsx"),
        "utf8",
      );
      // A redirect never renders anything to redirect away from.
      if (page.includes("redirect(")) return false;
      return !page.includes("<ProtectedRoute");
    });

    expect(unprotected).toEqual([]);
  });

  it("keeps /jobs behind the admin check", () => {
    const page = readFileSync(join(APP_DIRECTORY, "jobs/page.tsx"), "utf8");

    // `/jobs` exposes every player's sync state and the Riot key's health, and
    // it is the only admin-only page. Dropping `requireAdmin` still renders,
    // still typechecks, and shows all of it to any signed-in account.
    expect(page).toMatch(/<ProtectedRoute\s+requireAdmin\b/);
  });

  it("keeps every exempt route a redirect rather than a destination", () => {
    const destinations = [...NOT_NAVIGATION_TARGETS]
      .filter((route) => route !== "/")
      .filter((route) => {
        const page = readFileSync(
          join(APP_DIRECTORY, route, "page.tsx"),
          "utf8",
        );
        return !page.includes("redirect(");
      });

    expect(destinations).toEqual([]);
  });
});
