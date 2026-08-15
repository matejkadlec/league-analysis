import { expect, test } from "@playwright/test";

const NOW = "2026-08-09T10:00:00.000Z";
const CURRENT_PUUID = "current-player-puuid";
const RECENT_PUUID = "recent-player-puuid";
const THIRD_PUUID = "third-player-puuid";
const FOURTH_PUUID = "fourth-player-puuid";
const FIFTH_PUUID = "fifth-player-puuid";
const SIXTH_PUUID = "sixth-player-puuid";
const ANALYZED_PUUID = "analyzed-player-puuid";

const players = {
  [CURRENT_PUUID]: {
    puuid: CURRENT_PUUID,
    game_name: "Current",
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
  },
  [RECENT_PUUID]: {
    puuid: RECENT_PUUID,
    game_name: "Recent",
    tag_line: "TWO",
    platform: "euw1",
    is_tracked: true,
    analyzed_matches: 0,
    total_matches: 0,
    profile_synced_at: NOW,
    league_synced_at: NOW,
    match_synced_at: NOW,
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
    profile_synced_at: NOW,
    league_synced_at: NOW,
    match_synced_at: NOW,
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
    profile_synced_at: NOW,
    league_synced_at: NOW,
    match_synced_at: NOW,
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
    profile_synced_at: NOW,
    league_synced_at: NOW,
    match_synced_at: NOW,
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
    profile_synced_at: NOW,
    league_synced_at: NOW,
    match_synced_at: NOW,
    created_at: NOW,
    updated_at: NOW,
  },
};

const analyzedPlayer = {
  ...players[CURRENT_PUUID],
  puuid: ANALYZED_PUUID,
  game_name: "Analyzed",
  tag_line: "LOCAL",
  platform: "euw1",
  is_tracked: false,
};

test("keeps player routes, sidebar switching, and dialog scroll lock deterministic", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 650 });
  let currentPuuid = CURRENT_PUUID;
  let currentPlayerUpdates = 0;
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
        currentPlayerUpdates += 1;
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

    if (path.endsWith("/players/suggestions")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify([analyzedPlayer]),
      });
      return;
    }

    if (path.includes(`/matchmaking-analysis/player/${ANALYZED_PUUID}`)) {
      if (path.endsWith("/history")) {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ items: [] }),
        });
      } else {
        await route.fulfill({ status: 404, body: "Not found" });
      }
      return;
    }

    if (path.endsWith("/league")) {
      await route.fulfill({
        contentType: "application/json",
        body: "null",
      });
      return;
    }

    const statsPlayer = Object.values(players).find((candidate) =>
      path.includes(`/matches/player/${candidate.puuid}/`),
    );
    if (statsPlayer && path.endsWith("/champion-stats")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          puuid: statsPlayer.puuid,
          total_champions: 1,
          champions: [
            {
              champion_name: "Annie",
              champion_id: 1,
              games_played: 10,
              wins: 6,
              losses: 4,
              win_rate: 0.6,
              avg_kills: 7,
              avg_deaths: 4,
              avg_assists: 8,
              avg_kda: 3.75,
            },
          ],
        }),
      });
      return;
    }

    if (statsPlayer && path.endsWith("/lane-stats")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          puuid: statsPlayer.puuid,
          total_lanes: 1,
          lanes: [
            {
              lane: "MIDDLE",
              games_played: 10,
              wins: 6,
              losses: 4,
              win_rate: 0.6,
              avg_kills: 7,
              avg_deaths: 4,
              avg_assists: 8,
              avg_kda: 3.75,
            },
          ],
        }),
      });
      return;
    }

    if (statsPlayer && path.endsWith("/stats")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          puuid: statsPlayer.puuid,
          total_matches: 10,
          wins: 6,
          losses: 4,
          win_rate: 0.6,
          avg_kills: 7,
          avg_deaths: 4,
          avg_assists: 8,
          avg_kda: 3.75,
          avg_cs: 180,
          avg_vision_score: 24,
        }),
      });
      return;
    }

    if (statsPlayer && path.endsWith("/detailed")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          matches: [],
          total: 0,
          total_analyzed: 0,
          page: 1,
          size: 20,
          pages: 0,
        }),
      });
      return;
    }

    if (path.endsWith("/tracking-status")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ is_tracked: !path.includes(RECENT_PUUID) }),
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

  await page.goto("/player-overview");
  await page.getByRole("button", { name: "Accept necessary" }).click();

  await expect(page).toHaveURL(new RegExp(`puuid=${CURRENT_PUUID}`));
  const currentPlayerButton = page.getByTestId("current-player-button");
  await expect(currentPlayerButton).toBeVisible();
  await expect(page.getByText("Recent#TWO")).toHaveCount(0);
  await expect(page.locator("#player-summary")).toBeVisible();
  await expect(page.locator("#recent-performance")).toBeVisible();
  await expect(page.locator("#top-champions")).toBeVisible();
  await expect(page.locator("#role-performance")).toBeVisible();
  await expect(page.locator("#match-history")).toHaveCount(0);
  await expect(page.getByText(/^Updated /)).toHaveCount(4);
  await expect(
    page.getByText(
      "Review player's rank, recent performance, champion statistics, and role performance in one dashboard.",
    ),
  ).toBeVisible();

  const trackingTag = page.locator(".tracking-status-toggle");
  await expect(trackingTag).toBeVisible();
  await expect(trackingTag).toHaveText(/Tracked/);
  const trackingTagBeforeHover = await trackingTag.boundingBox();
  expect(trackingTagBeforeHover?.width).toBe(72);
  expect(trackingTagBeforeHover?.height).toBe(24);
  expect(
    await trackingTag.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await trackingTag.hover();
  await expect(trackingTag).toHaveText(/Untrack/);
  const trackingTagDuringHover = await trackingTag.boundingBox();
  expect(trackingTagDuringHover).toEqual(trackingTagBeforeHover);

  const quickNavigation = page.getByRole("button", {
    name: "Open page navigation",
  });
  await quickNavigation.hover();
  await expect(
    page.getByRole("navigation", { name: "Page sections" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Player Summary" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Match History" })).toHaveCount(
    0,
  );

  await expect(page.getByTestId("view-tracked-players-button")).toBeHidden();

  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight > innerHeight,
    ),
  ).toBe(true);
  const activeRowBeforeDialog = await currentPlayerButton.boundingBox();
  const pageUrlBeforeDialog = page.url();
  await currentPlayerButton.click();
  expect(page.url()).toBe(pageUrlBeforeDialog);
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Tracked Players" }),
  ).toBeVisible();
  await expect(
    dialog.getByText("View, add or remove tracked players."),
  ).toBeVisible();
  const activeRowDuringDialog = await currentPlayerButton.boundingBox();
  expect(
    Math.abs((activeRowDuringDialog?.x ?? 0) - (activeRowBeforeDialog?.x ?? 0)),
  ).toBeLessThanOrEqual(0.5);
  const dialogBox = await dialog.boundingBox();
  const viewport = page.viewportSize();
  const topSpace = dialogBox?.y ?? 0;
  const bottomSpace =
    (viewport?.height ?? 0) - ((dialogBox?.y ?? 0) + (dialogBox?.height ?? 0));
  expect(Math.abs(bottomSpace - topSpace * 2)).toBeLessThanOrEqual(2);
  await expect(dialog.getByText("Manage Tracked Players")).toHaveCount(0);
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

  const recentPlayerRow = dialog.getByTestId(
    `tracked-player-row-${RECENT_PUUID}`,
  );
  await recentPlayerRow.getByRole("button", { name: "View" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/player-overview\\?puuid=${RECENT_PUUID}`),
  );
  await expect(page.getByRole("button", { name: "Recent#TWO" })).toBeVisible();
  expect(syncStarts).toBe(0);

  const untrackedTag = page.locator(".tracking-status-toggle");
  await expect(untrackedTag).toHaveText(/Untracked/);
  const untrackedTagBeforeHover = await untrackedTag.boundingBox();
  expect(untrackedTagBeforeHover?.width).toBe(72);
  expect(untrackedTagBeforeHover?.height).toBe(24);
  const untrackedTagMetrics = await untrackedTag.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(untrackedTagMetrics.scrollWidth).toBeLessThanOrEqual(
    untrackedTagMetrics.clientWidth,
  );
  await untrackedTag.hover();
  await expect(untrackedTag).toHaveText(/Track/);
  expect(await untrackedTag.boundingBox()).toEqual(untrackedTagBeforeHover);

  const matchHistoryNav = page.getByRole("link", { name: "Match History" });
  await expect(matchHistoryNav).toHaveAttribute(
    "href",
    `/match-history?puuid=${RECENT_PUUID}`,
  );
  await matchHistoryNav.click();
  await expect(page).toHaveURL(
    new RegExp(`/match-history\\?puuid=${RECENT_PUUID}`),
  );
  await expect(page.locator("#match-history")).toBeVisible();
  await expect(page.locator("#player-summary")).toHaveCount(0);
  await expect(
    page.getByText(
      "Explore player's matches, queue results, team objectives, builds, runes, and performance details.",
    ),
  ).toBeVisible();

  const activePlayerFromMatchHistory = page.getByTestId(
    "current-player-button",
  );
  const matchHistoryUrl = page.url();
  await activePlayerFromMatchHistory.click();
  expect(page.url()).toBe(matchHistoryUrl);
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: "Tracked Players" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 1440, height: 2000 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight > innerHeight,
    ),
  ).toBe(true);
  const matchCardBeforeFilter = await page
    .locator("#match-history")
    .boundingBox();
  await page.getByRole("button", { name: "ARAM: Mayhem" }).click();
  await expect(
    page.getByRole("button", { name: "ARAM: Mayhem" }),
  ).toHaveAttribute("aria-pressed", "true");
  const matchCardAfterFilter = await page
    .locator("#match-history")
    .boundingBox();
  expect(
    Math.abs((matchCardAfterFilter?.x ?? 0) - (matchCardBeforeFilter?.x ?? 0)),
  ).toBeLessThanOrEqual(0.5);

  const playerOverviewLink = page.getByRole("link", {
    name: "Player Overview",
  });
  await expect(playerOverviewLink).toHaveAttribute(
    "href",
    `/player-overview?puuid=${RECENT_PUUID}`,
  );
  await playerOverviewLink.click();
  await expect(page).toHaveURL(
    new RegExp(`/player-overview\\?puuid=${RECENT_PUUID}`),
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= innerHeight,
    ),
  ).toBe(true);
  const noScrollRow = page.getByTestId("current-player-button");
  const noScrollBefore = await noScrollRow.boundingBox();
  await noScrollRow.click();
  const noScrollDuring = await noScrollRow.boundingBox();
  expect(
    Math.abs((noScrollDuring?.x ?? 0) - (noScrollBefore?.x ?? 0)),
  ).toBeLessThanOrEqual(0.5);
  await page.keyboard.press("Escape");

  const playerOverviewNav = page.getByRole("link", {
    name: "Player Overview",
  });
  await expect
    .poll(() =>
      playerOverviewNav.evaluate(
        (element) => getComputedStyle(element).borderLeftColor,
      ),
    )
    .toBe("rgb(207, 169, 58)");
  const overviewTextX = (await playerOverviewNav.locator("span").boundingBox())
    ?.x;
  const overviewNavStyle = await playerOverviewNav.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      borderLeftColor: style.borderLeftColor,
      borderLeftWidth: style.borderLeftWidth,
      transitionProperty: style.transitionProperty,
    };
  });
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL("/");
  const homeNav = page.getByRole("link", { name: "Home", exact: true });
  await expect(homeNav).toHaveAttribute("data-active", "true");
  await expect(
    page.getByText(
      "Welcome to League Analysis - your all in one tool for comprehensive analysis of League of Legends players, matches and matchmaking fairness as well as a great multiple player tracking tool.",
    ),
  ).toBeVisible();
  await expect
    .poll(() =>
      homeNav.evaluate((element) => getComputedStyle(element).borderLeftColor),
    )
    .toBe("rgb(207, 169, 58)");
  const homeTextX = (await homeNav.locator("span").boundingBox())?.x;
  const homeNavStyle = await homeNav.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      borderLeftColor: style.borderLeftColor,
      borderLeftWidth: style.borderLeftWidth,
      transitionProperty: style.transitionProperty,
    };
  });
  expect(homeNavStyle.borderLeftWidth).toBe("4px");
  expect(homeNavStyle.borderLeftColor).toBe(overviewNavStyle.borderLeftColor);
  expect(homeNavStyle.transitionProperty).toBe(
    overviewNavStyle.transitionProperty,
  );
  expect(homeNavStyle.transitionProperty).not.toBe("all");
  expect(Math.abs((homeTextX ?? 0) - (overviewTextX ?? 0))).toBeLessThanOrEqual(
    0.5,
  );

  await page.getByRole("link", { name: "Matchmaking Analysis" }).click();
  await expect(
    page.getByText(
      "Analyze matchmaking fairness by comparing average winrates of teammates vs enemies in recent ranked matches.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Player Search" }),
  ).toHaveCount(0);
  await expect(page.locator("#player-summary")).toHaveCount(0);
  await expect(
    page.getByText("Reference player (global)", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Analyzed player (this page)", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Last Analysis Result", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Calculation Flowchart", { exact: true }),
  ).toBeVisible();
  const hiddenFlowchartToggle = page.getByRole("button", {
    name: "Collapse",
    includeHidden: true,
  });
  await expect(hiddenFlowchartToggle).toHaveCount(1);
  await expect(hiddenFlowchartToggle).toBeHidden();
  await expect(
    page.getByRole("img", {
      name: "Matchmaking Analysis Calculation Explanation",
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Analysis History", { exact: true }),
  ).toBeVisible();

  const currentBeforeLocalSelection = currentPuuid;
  const contextUpdatesBeforeLocalSelection = currentPlayerUpdates;
  const analysisPlayerSearch = page.getByRole("textbox", {
    name: "Choose player for analysis",
  });
  await expect(analysisPlayerSearch).toHaveAttribute(
    "placeholder",
    "Search for player",
  );
  await analysisPlayerSearch.fill("Analyzed");
  await page.getByRole("option", { name: "Analyzed#LOCAL (EUW)" }).click();
  await expect(page).toHaveURL(new RegExp(`puuid=${ANALYZED_PUUID}`));
  const analyzedPlayerResultLabels = page
    .locator("p")
    .filter({ hasText: /^Results for player Analyzed#LOCAL$/ });
  await expect(analyzedPlayerResultLabels).toHaveCount(2);
  for (let index = 0; index < 2; index += 1) {
    const labelParts = analyzedPlayerResultLabels.nth(index).locator("span");
    await expect(labelParts.nth(0)).toHaveAttribute(
      "style",
      "color: var(--color-muted-foreground);",
    );
    await expect(labelParts.nth(1)).toHaveAttribute(
      "style",
      "color: var(--color-card-foreground);",
    );
  }
  expect(currentPuuid).toBe(currentBeforeLocalSelection);
  expect(currentPlayerUpdates).toBe(contextUpdatesBeforeLocalSelection);
  await expect(page.getByTestId("current-player-button")).toHaveText(
    /Recent#TWO/,
  );

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(
    page.getByText("Account Settings", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Application Settings", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Connected Riot Account", { exact: true }),
  ).toHaveCount(0);

  await page.goto(`/my-profile?puuid=${CURRENT_PUUID}`);
  await expect(page).toHaveURL(
    new RegExp(`/player-overview\\?puuid=${CURRENT_PUUID}`),
  );
  await page.goto(`/playstyle-analysis?puuid=${RECENT_PUUID}`);
  await expect(page).toHaveURL(
    new RegExp(`/player-overview\\?puuid=${RECENT_PUUID}`),
  );
});
