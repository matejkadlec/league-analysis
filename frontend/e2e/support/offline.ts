import type { Page } from "@playwright/test";

/**
 * Keep the suite off the public internet, `/_next/image` fetches included.
 * Abort rather than serve a placeholder pixel so `onError` stays exercised.
 */
export async function blockUpstreamRequests(page: Page): Promise<void> {
  // Stub the error beacon: a failing outbound POST retries and stalls the spec.
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
