import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `site-metadata.test.ts` pins the open/closed switch; this file pins the
 * document a crawler receives in each state. The policy is read at import
 * time, so each case stubs the environment and imports the route fresh.
 */

async function loadRobots() {
  vi.resetModules();
  const [{ default: robots }, { SITE_URL }] = await Promise.all([
    import("@/app/robots"),
    import("@/lib/core/site-url"),
  ]);
  return { robots, SITE_URL };
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://leagueanalysis.gg");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("robots.txt", () => {
  it("names this origin as its own host while it refuses every crawler", async () => {
    vi.stubEnv("NEXT_PUBLIC_ALLOW_INDEXING", undefined);
    const { robots, SITE_URL } = await loadRobots();

    const document = robots();
    expect(document.host).toBe(SITE_URL);
    expect(document.rules).toEqual({ userAgent: "*", disallow: "/" });
    // No sitemap to advertise: the sitemap would list pages the rules just
    // refused, which reads as an invitation.
    expect("sitemap" in document).toBe(false);
  });

  it("opens the site, advertises the sitemap, and keeps the host named", async () => {
    vi.stubEnv("NEXT_PUBLIC_ALLOW_INDEXING", "true");
    const { robots, SITE_URL } = await loadRobots();

    const document = robots();
    expect(document.host).toBe(SITE_URL);
    expect(document.rules).toEqual({ userAgent: "*", allow: "/" });
    expect(document.sitemap).toBe(`${SITE_URL}/sitemap.xml`);
  });
});
