import { expect, test } from "@playwright/test";

import { acceptCookieBanner, seedAuthenticatedSession } from "./support/auth";
import { blockUpstreamRequests } from "./support/offline";

/**
 * The hint cookie outlives the session it stands for, `proxy.ts` routes on the
 * hint alone, and the gate then rendered null. Every other spec mocks /auth/me
 * into a 200, which is why none of them cover this.
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
    // present but unreachable by role until this is dismissed.
    await acceptCookieBanner(page);

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

    // The heading, not just the button: both error boundaries render their
    // own "Try again", so a button-only assertion cannot tell this surface
    // apart from a crash page.
    await expect(page.getByText("Can't reach the server")).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/");
  });

  test("says something rather than nothing while a hung backend is probed", async ({
    page,
  }) => {
    // The variant closest to the original report: the server accepts the
    // connection and then never answers, so the probe runs its full ten-second
    // deadline. Every second of that used to be an empty white page.
    await page.route("**/api/v1/auth/**", async () => {
      // Deliberately never fulfilled.
      await new Promise(() => {});
    });

    await page.goto("/");

    await expect(page.getByText("Checking your session")).toBeVisible({
      timeout: 5_000,
    });
  });
});
