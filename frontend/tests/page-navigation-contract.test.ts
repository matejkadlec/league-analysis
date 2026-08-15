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

  it("keeps every exempt route a redirect rather than a destination", () => {
    const destinations = [...NOT_NAVIGATION_TARGETS]
      .filter((route) => route !== "/")
      .filter((route) => {
        const page = readFileSync(join(APP_DIRECTORY, route, "page.tsx"), "utf8");
        return !page.includes("redirect(");
      });

    expect(destinations).toEqual([]);
  });
});
