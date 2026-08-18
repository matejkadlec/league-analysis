import { expect, test } from "@playwright/test";

import { seedAuthenticatedSession } from "./support/auth";
import { blockUpstreamRequests } from "./support/offline";

/**
 * The reported bug, end to end: a black screen on a site that was working.
 *
 * The session hint cookie outlives the session it stands for -- it is written
 * for the refresh token's lifetime, but that token can be revoked or lost with
 * the row it lived in. `proxy.ts` routes on the hint alone, so it admitted the
 * visitor to a protected route, the client's probe then failed, and the gate
 * rendered null. Everything lives inside that gate, so the result was a page
 * with no sidebar, no toast host, no message and nothing to click.
 *
 * Every other spec in this suite seeds the same stranded cookie and then mocks
 * /auth/me into a 200, which is precisely why none of them ever saw this. Here
 * the API refuses, as it did in production.
 *
 * Both halves of each assertion matter. Checking only the URL would repeat the
 * mistake the unit tests made: a blank page that happens to sit at the right
 * address still tells the visitor nothing.
 */
test.describe("a session the API no longer honours", () => {
  test.beforeEach(async ({ page }) => {
    await blockUpstreamRequests(page);
    // The hint, and nothing behind it.
    await seedAuthenticatedSession(page);
  });

  test("lands on a usable sign-in page instead of a blank one", async ({
    page,
  }) => {
    await page.route("**/api/v1/auth/**", async (route) => {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          detail: {
            code: "INVALID_REFRESH_TOKEN",
            message: "Refresh token is invalid, expired, or already revoked.",
          },
        }),
      });
    });

    await page.goto("/");

    await expect(page).toHaveURL(/\/sign-in$/);
    // The consent dialog opens over the page and, being modal, takes
    // everything behind it out of the accessibility tree — so the form is
    // present but unreachable by role until this is dismissed. Every other
    // spec here does the same.
    await page.getByRole("button", { name: "Accept necessary" }).click();

    await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
    // The hint has to be gone, not merely ignored: while it survives,
    // `proxy.ts` sends this page straight back to /.
    const cookies = await page.context().cookies();
    expect(
      cookies.some((cookie) => cookie.name === "league_analysis_auth_state"),
    ).toBe(false);
  });

  test("offers a way forward when the API cannot be reached at all", async ({
    page,
  }) => {
    // Not a rejection -- the server is simply down. Redirecting here would
    // fight `proxy.ts`, which sends /sign-in back to / while the hint is set,
    // so the page has to say so instead of showing nothing.
    await page.route("**/api/v1/auth/**", async (route) => {
      await route.abort("connectionrefused");
    });

    await page.goto("/");

    await expect(
      page.getByRole("button", { name: "Try again" }),
    ).toBeVisible();
  });
});
