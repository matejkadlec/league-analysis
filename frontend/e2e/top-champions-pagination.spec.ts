import { expect, test } from "@playwright/test";

const NOW = "2026-08-07T10:00:00.000Z";
const PUUID = "test-player-puuid";

const champions = Array.from({ length: 12 }, (_, index) => ({
  avg_assists: 4.5,
  avg_deaths: 2,
  avg_kda: 5.25,
  avg_kills: 6,
  champion_id: index + 1,
  champion_name: `Champion${String(index + 1).padStart(2, "0")}`,
  games_played: 20 - index,
  losses: 5,
  win_rate: 0.75,
  wins: 15,
}));

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("auth_access_token", "test-access-token");
    localStorage.setItem("auth_refresh_token", "test-refresh-token");
  });

  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;

    if (path.endsWith("/auth/me")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          id: 1,
          email: "qa@example.test",
          display_name: "QA User",
          is_active: true,
          is_admin: false,
          email_verified: true,
          email_verified_at: NOW,
          last_login: NOW,
          riot_account_connected: true,
          puuid: PUUID,
          created_at: NOW,
          updated_at: NOW,
        }),
      });
      return;
    }

    if (path.endsWith(`/players/${PUUID}`)) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          puuid: PUUID,
          game_name: "QA",
          tag_line: "TEST",
          platform: "eun1",
          is_tracked: true,
          analyzed_matches: 40,
          total_matches: 40,
          created_at: NOW,
          updated_at: NOW,
        }),
      });
      return;
    }

    if (path.endsWith("/players/context/current")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          current_player: {
            puuid: PUUID,
            game_name: "QA",
            tag_line: "TEST",
            platform: "eun1",
            is_tracked: true,
            analyzed_matches: 40,
            total_matches: 40,
            created_at: NOW,
            updated_at: NOW,
          },
          tracked_players: [],
        }),
      });
      return;
    }

    if (path.endsWith("/players/context")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          current_player: {
            puuid: PUUID,
            game_name: "QA",
            tag_line: "TEST",
            platform: "eun1",
            is_tracked: true,
            analyzed_matches: 40,
            total_matches: 40,
            created_at: NOW,
            updated_at: NOW,
          },
          tracked_players: [],
        }),
      });
      return;
    }

    if (path.endsWith(`/matches/player/${PUUID}/champion-stats`)) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          puuid: PUUID,
          total_champions: champions.length,
          champions,
        }),
      });
      return;
    }

    if (
      path.endsWith("/settings/user/cookie-consent") &&
      route.request().method() === "PUT"
    ) {
      await route.fulfill({ contentType: "application/json", body: "{}" });
      return;
    }

    await route.fulfill({ status: 404, body: "Not found" });
  });
});

test("navigates complete Top Champions results in fixed five-row pages", async ({
  page,
}) => {
  await page.goto(`/player-overview?puuid=${PUUID}`);
  await page.getByRole("button", { name: "Accept necessary" }).click();

  const previous = page.getByRole("button", { name: "Previous champions" });
  const next = page.getByRole("button", { name: "Next champions" });
  const range = page.getByRole("status");

  await expect(range).toHaveText("1–5 of 12");
  await expect(previous).toBeDisabled();
  await expect(next).toBeEnabled();
  await expect(page.getByText("Champion01")).toBeVisible();
  await expect(page.getByText("Champion06")).toHaveCount(0);

  await next.click();
  await expect(range).toHaveText("6–10 of 12");
  await expect(page.getByText("Champion06")).toBeVisible();
  await expect(page.getByText("Champion11")).toHaveCount(0);

  await next.click();
  await expect(range).toHaveText("11–12 of 12");
  await expect(next).toBeDisabled();
  await expect(previous).toBeEnabled();
  await expect(page.getByText("Champion11")).toBeVisible();

  await previous.click();
  await expect(range).toHaveText("6–10 of 12");
});
