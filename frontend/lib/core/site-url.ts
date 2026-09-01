/**
 * Baked into the static payload at build time. `frontend/Dockerfile` refuses
 * to build without `NEXT_PUBLIC_SITE_URL`, so the default is dev-only.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"
).replace(/\/+$/, "");

/** Indexing is opt-in: only a build that says "true" may be crawled. */
export const SHOULD_ALLOW_INDEXING =
  process.env.NEXT_PUBLIC_ALLOW_INDEXING === "true";
