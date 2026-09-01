import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The route list is pinned as literal URLs: a legal page that stops reaching
 * the sitemap should fail here rather than move with the list that feeds it.
 */

async function loadSitemap() {
  vi.resetModules();
  const [{ default: sitemap }, { SITE_URL }] = await Promise.all([
    import("@/app/sitemap"),
    import("@/lib/core/site-url"),
  ]);
  return { sitemap, SITE_URL };
}

const ROUTES = ["/", "/license", "/privacy-policy", "/cookie-policy"];

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://leagueanalysis.gg");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("the sitemap", () => {
  it("lists the landing page and every legal page, and nothing else", async () => {
    const { sitemap, SITE_URL } = await loadSitemap();

    const entries = sitemap();
    expect(entries.map((entry) => entry.url)).toEqual(
      ROUTES.map((route) => `${SITE_URL}${route}`),
    );
  });

  it("marks every entry with the moment it was built", async () => {
    // `lastModified` is the only field a crawler uses to decide whether to
    // re-fetch; a fixed date would fossilise the whole sitemap on day one.
    const before = Date.now();
    const { sitemap } = await loadSitemap();

    // Filtered with a predicate, so the count assertion says every entry
    // carries a Date, not just that some of them do.
    const stamps = sitemap()
      .map((entry) => entry.lastModified)
      .filter((stamp): stamp is Date => stamp instanceof Date);
    expect(stamps).toHaveLength(ROUTES.length);
    for (const stamp of stamps) {
      expect(stamp.getTime()).toBeGreaterThanOrEqual(before);
      expect(stamp.getTime()).toBeLessThanOrEqual(Date.now());
    }
  });

  it("ranks the landing page above the legal pages", async () => {
    const { sitemap, SITE_URL } = await loadSitemap();

    const entries = sitemap();
    const landing = entries.find((entry) => entry.url === `${SITE_URL}/`);
    const legal = entries.filter((entry) => entry.url !== `${SITE_URL}/`);

    expect(landing?.priority).toBe(1);
    expect(landing?.changeFrequency).toBe("weekly");
    expect(legal.length).toBeGreaterThan(0);
    for (const entry of legal) {
      expect(entry.priority).toBe(0.3);
      expect(entry.changeFrequency).toBe("monthly");
    }
  });
});
