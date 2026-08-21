import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `robots.txt`, the sitemap and the indexing opt-in had no test at all.
 *
 * This site is not to be crawled until Riot's review clears, and the whole
 * gate is one comparison in `lib/core/site-url.ts`. Loosening it to
 * `!== "false"` -- so a build that merely forgets the variable is indexable --
 * kept every one of the other 679 tests green.
 *
 * The two modules read `process.env` at import time, so each case stubs the
 * environment and then imports fresh.
 */
async function loadRoutes() {
  vi.resetModules();
  const [{ default: robots }, { default: sitemap }, { SITE_URL }] =
    await Promise.all([
      import("@/app/robots"),
      import("@/app/sitemap"),
      import("@/lib/core/site-url"),
    ]);
  return { robots, sitemap, SITE_URL };
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://dev.leagueanalysis.gg");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("crawl policy", () => {
  it("disallows everything when indexing was not asked for", async () => {
    vi.stubEnv("NEXT_PUBLIC_ALLOW_INDEXING", undefined);
    const { robots } = await loadRoutes();

    const rules = robots().rules;
    expect(Array.isArray(rules)).toBe(false);
    expect(rules).toMatchObject({ userAgent: "*", disallow: "/" });
    expect(robots().sitemap).toBeUndefined();
  });

  it("stays closed for any value that is not exactly \"true\"", async () => {
    for (const value of ["false", "TRUE", "1", "yes", ""]) {
      vi.stubEnv("NEXT_PUBLIC_ALLOW_INDEXING", value);
      const { robots } = await loadRoutes();
      expect(robots().rules, `NEXT_PUBLIC_ALLOW_INDEXING=${value}`).toMatchObject({
        disallow: "/",
      });
    }
  });

  it("opens up and points at the sitemap when it is", async () => {
    vi.stubEnv("NEXT_PUBLIC_ALLOW_INDEXING", "true");
    const { robots, SITE_URL } = await loadRoutes();

    expect(robots().rules).toMatchObject({ userAgent: "*", allow: "/" });
    expect(robots().sitemap).toBe(`${SITE_URL}/sitemap.xml`);
  });
});

describe("sitemap urls", () => {
  it("keeps one slash between the origin and the route", async () => {
    // The origin arrives from an env var a person types, and a trailing
    // slash there used to emit https://host//route for every entry.
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://dev.leagueanalysis.gg/");
    const { sitemap } = await loadRoutes();

    const entries = sitemap();
    expect(entries.length).toBeGreaterThan(1);
    for (const entry of entries) {
      expect(entry.url.startsWith("https://dev.leagueanalysis.gg/")).toBe(true);
      expect(entry.url.slice("https://".length)).not.toContain("//");
    }
  });

  it("gives the landing page the highest priority", async () => {
    const { sitemap, SITE_URL } = await loadRoutes();

    const landing = sitemap().find((entry) => entry.url === `${SITE_URL}/`);
    expect(landing?.priority).toBe(1);
  });
});
