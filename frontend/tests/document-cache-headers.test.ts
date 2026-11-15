import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  DOCUMENT_CACHE_CONTROL,
  HASHED_STATIC_CACHE_CONTROL,
  SECURITY_HEADERS,
} from "../next.config";

/**
 * A cached HTML document after a deploy still names the previous image's
 * `/_next/static` hashes, so the browser asks for an asset the origin 404s and
 * React mounts `undefined`. Hashed assets stay immutable; documents may not.
 */
describe("document cache headers", () => {
  it("forbids storing HTML and reaffirms immutable hashed assets, in that order", async () => {
    vi.resetModules();
    const { default: nextConfig } = await import("../next.config");
    const rules = await nextConfig.headers?.();

    // Spelled out rather than read back from `DOCUMENT_CACHE_CONTROL`: a header
    // asserted to equal the constant it is built from cannot disagree with it,
    // so `public, max-age=31536000, immutable` would pass just as happily.
    const documents = "private, no-cache, no-store, max-age=0, must-revalidate";
    expect(DOCUMENT_CACHE_CONTROL).toBe(documents);

    expect(rules).toEqual([
      {
        source: "/",
        headers: [
          { key: "Cache-Control", value: documents },
          ...SECURITY_HEADERS,
        ],
      },
      {
        source: "/:path*",
        headers: [
          { key: "Cache-Control", value: documents },
          ...SECURITY_HEADERS,
        ],
      },
      {
        source: "/_next/static/:path*",
        headers: [
          { key: "Cache-Control", value: HASHED_STATIC_CACHE_CONTROL },
        ],
      },
    ]);
  });

  it("does not pin a deployment id when the build did not name one", async () => {
    vi.stubEnv("NEXT_DEPLOYMENT_ID", undefined);
    vi.resetModules();
    const { default: nextConfig } = await import("../next.config");
    expect(nextConfig.deploymentId).toBeUndefined();
  });

  it("uses the named deployment id when the image build supplied one", async () => {
    vi.stubEnv("NEXT_DEPLOYMENT_ID", "a28ef5fa87c37ccf1ce28e95db86615dbacb1552");
    vi.resetModules();
    const { default: nextConfig } = await import("../next.config");
    expect(nextConfig.deploymentId).toBe(
      "a28ef5fa87c37ccf1ce28e95db86615dbacb1552",
    );
  });
});

describe("security headers", () => {
  it("sends the browser hardening headers with every document", () => {
    // Literal values, for the same reason as the cache header above.
    expect(Object.fromEntries(SECURITY_HEADERS.map((h) => [h.key, h.value]))).toEqual({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
      "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    });
  });
});

describe("API rewrite", () => {
  it("forwards the versioned API and nothing else of the backend", async () => {
    vi.stubEnv("API_INTERNAL_URL", "http://backend:8000");
    vi.resetModules();
    const { default: nextConfig } = await import("../next.config");

    // `/api/:path*` also matched `/api` itself, which is where the backend
    // serves its interactive documentation.
    expect(await nextConfig.rewrites?.()).toEqual([
      {
        source: "/api/v1/:path*",
        destination: "http://backend:8000/api/v1/:path*",
      },
    ]);
  });
});

describe("local build identity", () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

  it("pins the same deployment id on the gate build and the Playwright server", () => {
    const testSh = readFileSync(join(repoRoot, "test.sh"), "utf8");
    const playwright = readFileSync(
      join(repoRoot, "frontend/playwright.config.ts"),
      "utf8",
    );
    expect(testSh).toMatch(/NEXT_DEPLOYMENT_ID=gate-local/);
    expect(playwright).toMatch(/NEXT_DEPLOYMENT_ID: "gate-local"/);
  });
});
