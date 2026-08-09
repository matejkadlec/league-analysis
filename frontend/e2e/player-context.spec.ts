import { expect, test } from "@playwright/test";

const NOW = "2026-08-09T10:00:00.000Z";
const CURRENT_PUUID = "current-player-puuid";
const RECENT_PUUID = "recent-player-puuid";

const players = {
  [CURRENT_PUUID]: {
    puuid: CURRENT_PUUID,
    game_name: "Current",
    tag_line: "ONE",
    platform: "eun1",
    is_tracked: true,
    analyzed_matches: 0,
    total_matches: 0,
    created_at: NOW,
    updated_at: NOW,
  },
  [RECENT_PUUID]: {
    puuid: RECENT_PUUID,
    game_name: "Recent",
    tag_line: "TWO",
    platform: "euw1",
    is_tracked: true,
    analyzed_matches: 0,
    total_matches: 0,
    created_at: NOW,
    updated_at: NOW,
  },
};

test("quick-switches the URL-scoped current player without starting sync", async ({
  page,
}) => {
  let currentPuuid = CURRENT_PUUID;
  let syncStarts = 0;

  await page.addInitScript(() => {
    localStorage.setItem("auth_access_token", "test-access-token");
    localStorage.setItem("auth_refresh_token", "test-refresh-token");
  });

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path.endsWith("/auth/me")) {
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
      return;
    }

    if (
      path.endsWith("/players/context") ||
      path.endsWith("/players/context/current")
    ) {
      if (path.endsWith("/players/context/current")) {
        const body = request.postDataJSON() as { puuid: string };
        currentPuuid = body.puuid;
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          current_player: players[currentPuuid as keyof typeof players],
          tracked_players: [players[RECENT_PUUID], players[CURRENT_PUUID]],
        }),
      });
      return;
    }

    const player = Object.values(players).find((candidate) =>
      path.endsWith(`/players/${candidate.puuid}`),
    );
    if (player) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(player),
      });
      return;
    }

    if (path.includes("/sync") && request.method() === "POST") {
      syncStarts += 1;
    }

    if (
      path.endsWith("/settings/user/cookie-consent") &&
      request.method() === "PUT"
    ) {
      await route.fulfill({ contentType: "application/json", body: "{}" });
      return;
    }

    await route.fulfill({ status: 404, body: "Not found" });
  });

  await page.goto("/my-profile");
  await page.getByRole("button", { name: "Accept necessary" }).click();

  await expect(page).toHaveURL(new RegExp(`puuid=${CURRENT_PUUID}`));
  await expect(page.getByText("Current#ONE").first()).toBeVisible();
  await page.getByRole("button", { name: "Recent#TWO" }).click();

  await expect(page).toHaveURL(new RegExp(`puuid=${RECENT_PUUID}`));
  await expect(page.getByText("Recent#TWO").first()).toBeVisible();
  expect(syncStarts).toBe(0);
});
