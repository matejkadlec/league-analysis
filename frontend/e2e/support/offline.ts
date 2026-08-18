import type { Page } from "@playwright/test";

/** A 1x1 transparent PNG, served in place of every upstream image. */
const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * Keep the suite off the public internet.
 *
 * The specs mock the API, but that is not the whole of what a player page
 * requests. Champion, profile and summoner-spell icons come straight from Riot's
 * CDN, and `champion-stats-card` and `player-card` omit `unoptimized`, so
 * theirs route through `/_next/image` and are fetched by the Next server rather
 * than the browser. Both are public-internet dependencies the gate would
 * otherwise carry: they 403 harmlessly today, but a slow or blocked CDN turns
 * into a flaky run.
 *
 * The manifest fetch behind `resolveDDragonVersion` is server-side too, and no
 * browser-level route reaches it; `playwright.config.ts` pins `DDRAGON_VERSION`
 * so that one never runs at all.
 *
 * Images are answered with a pixel rather than aborted. Aborting is instant,
 * so `onError` fires while React is still hydrating and the state it sets
 * ("this icon failed, use the fallback") counts as a mismatch — React then
 * throws away the server HTML and re-renders the tree. A real 403 arrives long
 * after hydration and never does that. Serving a pixel also keeps the layout
 * measurable: a broken image reports its alt text's width, which is not the
 * width the mobile specs exist to check.
 *
 * `/_next/image` is only intercepted when it is proxying an absolute URL. The
 * app serves its own logo through it too, and that one is local.
 */
export async function blockUpstreamRequests(page: Page): Promise<void> {
  await page.route(
    (url) =>
      url.hostname !== "127.0.0.1" ||
      (url.pathname === "/_next/image" &&
        /^https?:\/\//.test(url.searchParams.get("url") ?? "")),
    (route) =>
      route.request().resourceType() === "image"
        ? route.fulfill({ contentType: "image/png", body: TRANSPARENT_PNG })
        : route.abort(),
  );
}
