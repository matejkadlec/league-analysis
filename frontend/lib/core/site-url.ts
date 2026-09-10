/**
 * The site's own origin and its crawl policy, declared once and baked into the
 * static payload at build time. Local use defaults to localhost; an explicit
 * `NEXT_PUBLIC_SITE_URL` overrides that origin.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"
).replace(/\/+$/, "");

/** Indexing is opt-in: only a build that says "true" may be crawled. */
export const SHOULD_ALLOW_INDEXING =
  process.env.NEXT_PUBLIC_ALLOW_INDEXING === "true";
