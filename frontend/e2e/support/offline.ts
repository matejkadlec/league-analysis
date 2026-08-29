import type { Page } from "@playwright/test";

/**
 * Keep the suite off the public internet: icon requests go to Riot's CDN, and
 * the two cards without `unoptimized` route through `/_next/image` server-side.
 * Aborting rather than serving a placeholder pixel leaves `onError` exercised.
 */
export async function blockUpstreamRequests(page: Page): Promise<void> {
  // The production beacon POSTs here so docker logs can see client failures.
  // Stubbed rather than left on the real origin: a spec should not depend on
  // an outbound request, and a failing one retries.
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
