import type { Page } from "@playwright/test";

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
 * browser-level route reaches it. `test.sh` pins `DDRAGON_VERSION` on the build
 * and `playwright.config.ts` pins it on the server, which between them cover
 * the prerendered and the dynamic routes.
 *
 * Aborting is safe here. It was worth checking, because an abort is instant
 * where a real 403 is not, and the icons that fail this way sit behind an
 * `onError` fallback in `player-card`. Under `next dev` that did coincide with
 * a hydration mismatch — but serving a placeholder pixel instead did not fix
 * it, and moving the suite onto the production build did, so the abort was
 * never the cause. Aborting also leaves the fallback branch exercised, which a
 * pixel would quietly stop covering.
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
    (route) => route.abort(),
  );
}
