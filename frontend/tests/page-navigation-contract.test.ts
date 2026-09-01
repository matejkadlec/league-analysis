import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const APP_DIRECTORY = join(process.cwd(), "app");
// A text search, not an import: a route deleted from the JSX must fail here even
// while it is a valid string elsewhere. An extracted link module must be listed.
const SIDEBAR_SOURCES = [
  "components/sidebar-nav.tsx",
  "components/legal-notice.tsx",
  "lib/core/legal-pages.ts",
]
  .map((file) => readFileSync(join(process.cwd(), file), "utf8"))
  .join("\n");

// The root route is the shell itself rather than a navigation target.
const NOT_NAVIGATION_TARGETS = new Set(["/"]);

// Everything else in app/ that is not a redirect has to be wrapped, so a new
// page fails this test unless someone adds it here on purpose.
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
        !SIDEBAR_SOURCES.includes(`"${route}"`),
    );

    expect(unregistered).toEqual([]);
  });

  it("keeps every page that is not public behind ProtectedRoute", () => {
    // Asserted against source text: what is pinned is the wrapper's presence in
    // every page's tree, which a render test proves for only one.
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

    // `/jobs` is the only admin-only page, and dropping `requireAdmin` still
    // renders and typechecks while showing the Riot key's health to anyone.
    expect(page).toMatch(/<ProtectedRoute\s+requireAdmin\b/);
  });
});
