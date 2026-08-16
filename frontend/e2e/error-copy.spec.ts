import { expect, test, type Page } from "@playwright/test";

/**
 * Browser evidence for the 2026-08 error-copy sweep: the rewritten error
 * states, exercised in a real Chromium against mocked API responses.
 */

const NOW = "2026-08-16T10:00:00.000Z";

async function signIn(page: Page, overrides: Record<string, unknown> = {}) {
  await page.addInitScript(() => {
    localStorage.setItem("auth_access_token", "test-access-token");
    localStorage.setItem("auth_refresh_token", "test-refresh-token");
  });

  await page.route("**/api/v1/auth/me", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: 7,
        email: "qa@example.test",
        display_name: "QA User",
        is_active: true,
        is_admin: false,
        email_verified: true,
        email_verified_at: NOW,
        last_login: NOW,
        riot_account_connected: false,
        puuid: null,
        created_at: NOW,
        updated_at: NOW,
        ...overrides,
      }),
    });
  });
}

test("unknown routes offer a way back home", async ({ page }) => {
  await signIn(page);
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().url().includes("/auth/me")) {
      return route.fallback();
    }
    await route.fulfill({ contentType: "application/json", body: "[]" });
  });

  await page.goto("/this-route-does-not-exist");

  await expect(
    page.getByRole("heading", { name: "This page does not exist" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Go to home page" }),
  ).toBeVisible();
});

test("a structured RIOT_API_KEY_INVALID 503 becomes the admin-contact toast", async ({
  page,
}) => {
  await signIn(page);

  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/auth/me")) {
      return route.fallback();
    }

    if (url.pathname.endsWith("/players/add-tracked")) {
      // The exact body the backend now sends (players/router.py,
      // RIOT_API_KEY_INVALID_DETAIL).
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          detail: {
            code: "RIOT_API_KEY_INVALID",
            message:
              "Riot data is temporarily unavailable. Please contact an administrator.",
          },
        }),
      });
      return;
    }

    if (url.pathname.endsWith("/players/suggestions")) {
      await route.fulfill({ contentType: "application/json", body: "[]" });
      return;
    }

    await route.fulfill({ contentType: "application/json", body: "[]" });
  });

  await page.goto("/tracked-players");

  await page.getByLabel("Player Name").fill("SomeName#1234");
  await page.getByRole("button", { name: "Track Player" }).click();

  await expect(
    page.getByText("Player tracking is temporarily unavailable"),
  ).toBeVisible();
  await expect(
    page.getByText(
      "The Riot API key is invalid or expired. Please contact an administrator.",
    ),
  ).toBeVisible();
});

test("a curated 404 detail from the backend is shown to the viewer", async ({
  page,
}) => {
  await signIn(page);

  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/auth/me")) {
      return route.fallback();
    }

    if (url.pathname.endsWith("/players/add-tracked")) {
      // The rewritten players/service.py copy (no raw PUUID).
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({
          detail: "Player details were not found on this server.",
        }),
      });
      return;
    }

    await route.fulfill({ contentType: "application/json", body: "[]" });
  });

  await page.goto("/tracked-players");

  await page.getByLabel("Player Name").fill("SomeName#1234");
  await page.getByRole("button", { name: "Track Player" }).click();

  // tracking-feedback.ts rewrites 404s into its own player-facing sentence.
  await expect(
    page.getByText("Player SomeName#1234 wasn't found on server EUNE."),
  ).toBeVisible();
});
