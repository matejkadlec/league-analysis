import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  DOCUMENT_CACHE_CONTROL,
  HASHED_STATIC_CACHE_CONTROL,
} from "../next.config";

/**
 * After a deploy, a cached HTML document still names the previous image's
 * `/_next/static` hashes. Cloudflare was willing to keep that document for
 * six hours (`s-maxage=21600`) and to serve it stale for a year
 * (`stale-while-revalidate=31514400`). The browser then asked for
 * `1-1rz19yxhyis.js`, the origin 404'd, and React mounted `undefined`
 * (minified error #130). Hashed assets may stay immutable; documents may not.
 */
describe("document cache headers", () => {
  it("forbids storing HTML and reaffirms immutable hashed assets, in that order", async () => {
    vi.resetModules();
    const { default: nextConfig } = await import("../next.config");
    const rules = await nextConfig.headers?.();
    expect(rules).toEqual([
      {
        source: "/",
        headers: [{ key: "Cache-Control", value: DOCUMENT_CACHE_CONTROL }],
      },
      {
        source: "/:path*",
        headers: [{ key: "Cache-Control", value: DOCUMENT_CACHE_CONTROL }],
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

describe("the production image passes the commit as the deployment id", () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

  it("requires NEXT_DEPLOYMENT_ID at image build and keeps it at runtime", () => {
    const dockerfile = readFileSync(
      join(repoRoot, "frontend/Dockerfile"),
      "utf8",
    );
    expect(dockerfile).toMatch(/ARG NEXT_DEPLOYMENT_ID\b/);
    expect(dockerfile).toMatch(
      /: "\$\{NEXT_DEPLOYMENT_ID:\?must be passed as a build arg\}"/,
    );
    // The runtime stage re-declares the ARG; a builder-only ARG dies at FROM.
    const runtimeStage = dockerfile.slice(
      dockerfile.indexOf("FROM node:26.7.0-bookworm-slim AS runtime"),
    );
    expect(runtimeStage).toMatch(/ARG NEXT_DEPLOYMENT_ID\b/);
    expect(runtimeStage).toMatch(/NEXT_DEPLOYMENT_ID=\$NEXT_DEPLOYMENT_ID/);
  });

  it("feeds Compose's image tag to both the build and the running container", () => {
    const compose = readFileSync(
      join(repoRoot, "compose.production.yml"),
      "utf8",
    );
    expect(compose).toMatch(
      /NEXT_DEPLOYMENT_ID: \$\{LGA_IMAGE_TAG:-production\}/,
    );
    expect(
      compose.match(/NEXT_DEPLOYMENT_ID: \$\{LGA_IMAGE_TAG:-production\}/g),
    ).toHaveLength(2);
  });

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
