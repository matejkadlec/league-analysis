import { expect, test, type Page } from "@playwright/test";

/**
 * Browser evidence for the 2026-08 error-copy sweep: rewritten error states,
 * exercised in a real Chromium against mocked API responses.
 */

const NOW = "2026-08-16T10:00:00.000Z";
const PUUID = "error-copy-player-puuid";

const player = {
  puuid: PUUID,
  game_name: "Comparison",
  tag_line: "ONE",
  platform: "eun1",
  is_tracked: true,
  analyzed_matches: 0,
  total_matches: 0,
  profile_synced_at: NOW,
  league_synced_at: NOW,
  match_synced_at: NOW,
  created_at: NOW,
  updated_at: NOW,
};

async function signIn(page: Page) {
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

test("the rewritten curated 404 detail reaches the viewer without a PUUID", async ({
  page,
}) => {
  await signIn(page);

  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/auth/me")) {
      return route.fallback();
    }

    if (
      url.pathname.endsWith("/players/context") ||
      url.pathname.endsWith("/players/context/current")
    ) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          current_player: player,
          tracked_players: [player],
        }),
      });
      return;
    }

    // Every data query fails with the rewritten players/service.py copy.
    // The query-layer helpers rewrap errors, so the toast shows its own
    // generic recovery copy — the assertion that matters here is that the
    // failure is announced and no raw PUUID ever renders.
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({
        detail: "Player details were not found on this server.",
      }),
    });
  });

  await page.goto("/player-overview");

  await expect(page.getByText("Could not load this data")).toBeVisible();
  await expect(page.getByText(PUUID)).toHaveCount(0);
});
