import type { Page } from "@playwright/test";

/**
 * Abort everything the app would fetch from outside the test server.
 *
 * The specs mock the API, but that is not the whole of what a player page
 * requests. Champion, profile and summoner-spell icons come straight from Riot's
 * CDN, and the two `<Image>` call sites that omit `unoptimized` route theirs
 * through `/_next/image`, which the Next server — not the browser — fetches
 * upstream. Both are public-internet dependencies the gate would otherwise
 * carry: they 403 harmlessly today, but a slow or blocked CDN turns into a
 * flaky run.
 *
 * The manifest fetch behind `resolveDDragonVersion` is server-side too, and no
 * browser-level route reaches it; `playwright.config.ts` pins `DDRAGON_VERSION`
 * so that one never runs at all.
 *
 * `/_next/image` is only blocked when it is proxying an absolute URL. The app
 * also serves its own logo through it, and aborting that would blank a local
 * asset for no reason.
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
