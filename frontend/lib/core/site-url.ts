/**
 * The site's own origin and its crawl policy, declared once.
 *
 * Both are baked into the static payload at build time, and
 * `frontend/Dockerfile` refuses to build without `NEXT_PUBLIC_SITE_URL` -- so
 * every deployed image carries the real origin and the default below is
 * reachable only from `npm run dev`, where localhost is what the browser is
 * actually talking to. The literal it replaces, repeated in all three
 * metadata routes, was `https://leagueanalysis.gg`: not the deployed domain,
 * and so a value that could only ever have put a wrong host into robots.txt,
 * the sitemap and every canonical link.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"
).replace(/\/+$/, "");

/** Indexing is opt-in: only a build that says "true" may be crawled. */
export const SHOULD_ALLOW_INDEXING =
  process.env.NEXT_PUBLIC_ALLOW_INDEXING === "true";
