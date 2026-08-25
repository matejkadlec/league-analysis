import type { Page } from "@playwright/test";

/**
 * Keep the suite off the public internet: icon requests go to Riot's CDN, and
 * the two cards without `unoptimized` route through `/_next/image` server-side.
 * Aborting rather than serving a placeholder pixel is deliberate -- it leaves
 * the `onError` fallback exercised.
 */
export async function blockUpstreamRequests(page: Page): Promise<void> {
  // The production beacon POSTs here so docker logs can see client
  // failures. Populated-page specs then wait for networkidle; leaving
  // those beacons on the real origin kept the network busy for the whole
  // 60s timeout.
  await page.route("**/client-error-report", (route) =>
    route.fulfill({ status: 204, body: "" }),
  );
  await page.route(
    (url) =>
      url.hostname !== "127.0.0.1" ||
      (url.pathname === "/_next/image" &&
        /^https?:\/\//.test(url.searchParams.get("url") ?? "")),
    (route) => route.abort(),
  );
}
