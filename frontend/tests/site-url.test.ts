import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The module reads the environment at import time, so each case stubs the
 * variables and imports it fresh — the same pattern `robots.test.ts` uses for
 * the crawl policy.
 */

async function loadSiteUrl() {
  vi.resetModules();
  return import("@/lib/core/site-url");
}

describe("site-url", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_ALLOW_INDEXING", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("falls back to the dev origin when no site URL is configured", async () => {
    const { SITE_URL } = await loadSiteUrl();
    expect(SITE_URL).toBe("http://localhost:3000");
  });

  it("strips trailing slashes from the configured origin", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://league.example///");
    const { SITE_URL } = await loadSiteUrl();
    expect(SITE_URL).toBe("https://league.example");
  });

  it("allows indexing only when the build says exactly \"true\"", async () => {
    const closed = await loadSiteUrl();
    expect(closed.SHOULD_ALLOW_INDEXING).toBe(false);

    vi.stubEnv("NEXT_PUBLIC_ALLOW_INDEXING", "true");
    const open = await loadSiteUrl();
    expect(open.SHOULD_ALLOW_INDEXING).toBe(true);

    vi.stubEnv("NEXT_PUBLIC_ALLOW_INDEXING", "TRUE");
    const cased = await loadSiteUrl();
    expect(cased.SHOULD_ALLOW_INDEXING).toBe(false);
  });
});
