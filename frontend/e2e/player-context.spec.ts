import { expect, test } from "@playwright/test";

const NOW = "2026-08-09T10:00:00.000Z";
const CURRENT_PUUID = "current-player-puuid";
const RECENT_PUUID = "recent-player-puuid";
const THIRD_PUUID = "third-player-puuid";
const FOURTH_PUUID = "fourth-player-puuid";
const FIFTH_PUUID = "fifth-player-puuid";
const SIXTH_PUUID = "sixth-player-puuid";

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
  [THIRD_PUUID]: {
    puuid: THIRD_PUUID,
    game_name: "Third",
    tag_line: "THR",
    platform: "eun1",
    is_tracked: true,
    analyzed_matches: 0,
    total_matches: 0,
    created_at: NOW,
    updated_at: NOW,
  },
  [FOURTH_PUUID]: {
    puuid: FOURTH_PUUID,
    game_name: "Fourth",
    tag_line: "FOR",
    platform: "eun1",
    is_tracked: true,
    analyzed_matches: 0,
    total_matches: 0,
    created_at: NOW,
    updated_at: NOW,
  },
  [FIFTH_PUUID]: {
    puuid: FIFTH_PUUID,
    game_name: "Fifth",
    tag_line: "FIV",
    platform: "eun1",
    is_tracked: true,
    analyzed_matches: 0,
    total_matches: 0,
    created_at: NOW,
    updated_at: NOW,
  },
  [SIXTH_PUUID]: {
    puuid: SIXTH_PUUID,
    game_name: "Sixth",
    tag_line: "SIX",
    platform: "eun1",
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
  await page.setViewportSize({ width: 1440, height: 900 });
  let currentPuuid = CURRENT_PUUID;
  let syncStarts = 0;

  await page.addInitScript(() => {
    localStorage.setItem("auth_access_token", "test-access-token");
    localStorage.setItem("auth_refresh_token", "test-refresh-token");
    localStorage.setItem("theme", "dark");
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
          tracked_players: Object.values(players),
        }),
      });
      return;
    }

    if (path.endsWith("/players/tracked/list")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(Object.values(players)),
      });
      return;
    }

    if (path.endsWith("/league")) {
      await route.fulfill({
        contentType: "application/json",
        body: "null",
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

  const manageButton = page.getByRole("button", {
    name: "Manage Tracked Players",
  });
  const matchmakingLink = page.getByRole("link", {
    name: "Matchmaking Analysis",
  });
  const userName = page.getByText("QA User", { exact: true });
  const [sidebarBox, manageBox, matchmakingBox, userBox] = await Promise.all([
    page.locator("aside").boundingBox(),
    manageButton.boundingBox(),
    matchmakingLink.boundingBox(),
    userName.boundingBox(),
  ]);
  expect(manageBox?.y).toBeGreaterThan(matchmakingBox?.y ?? 0);
  expect(manageBox?.y).toBeLessThan(userBox?.y ?? Number.POSITIVE_INFINITY);
  const leftInset = (manageBox?.x ?? 0) - (sidebarBox?.x ?? 0);
  const rightInset =
    (sidebarBox?.x ?? 0) +
    (sidebarBox?.width ?? 0) -
    ((manageBox?.x ?? 0) + (manageBox?.width ?? 0));
  expect(Math.abs(leftInset - rightInset)).toBeLessThanOrEqual(1);

  await manageButton.click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Manage Tracked Players" }),
  ).toBeVisible();
  await expect(dialog.getByText("Tracked Players", { exact: true })).toHaveCount(
    0,
  );
  await expect(dialog.getByLabel("Search tracked players")).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: /expand|collapse/i }),
  ).toHaveCount(0);
  await expect(dialog.getByRole("heading", { level: 3 })).toHaveCount(6);

  const scrollRegion = dialog.getByTestId("tracked-players-scroll-region");
  await expect(scrollRegion).toHaveClass(/overflow-y-auto/);
  expect(
    await scrollRegion.evaluate((element) => element.parentElement?.id),
  ).toBe("tracked-players");
  expect(
    await scrollRegion.evaluate(
      (element) => element.scrollHeight > element.clientHeight,
    ),
  ).toBe(true);
});
