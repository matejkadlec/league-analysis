import { expect, test, type Page } from "@playwright/test";

import {
  ANALYZED_PUUID,
  CURRENT_PUUID,
  RECENT_PUUID,
  startAtPlayerOverview,
} from "./support/player-context-harness";

// Each test installs its own mocks and its own copy of the mutable counters,
// so they share no state across parallel pages.
test.describe.configure({ mode: "parallel" });

// By accessible name, not class, so a restyle cannot break the locator.
const trackingToggle = (page: Page) =>
  page.getByRole("button", { name: /^(Track|Untrack) player$/ });

const detailedMatchesRequest = (
  page: Page,
  puuid: string,
  params: Record<string, string | null>,
) =>
  page.waitForRequest((request) => {
    const requestUrl = new URL(request.url());
    return (
      requestUrl.pathname.endsWith(`/matches/player/${puuid}/detailed`) &&
      Object.entries(params).every(
        ([name, value]) => requestUrl.searchParams.get(name) === value,
      )
    );
  });

test("routes player overview to the account's player and switches it", async ({
  page,
}) => {
  const state = await startAtPlayerOverview(page);

  await test.step("the current player's overview renders its own sections", async () => {
    await expect(page).toHaveURL(new RegExp(`puuid=${CURRENT_PUUID}`));
    await expect(page.getByTestId("current-player-button")).toBeVisible();
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
  });

  await test.step("a tracked player's toggle offers to untrack without resizing", async () => {
    const trackingTag = trackingToggle(page);
    await expect(trackingTag).toBeVisible();
    await expect(trackingTag).toHaveText(/Tracked/);
    const trackingTagBeforeHover = await trackingTag.boundingBox();
    expect.soft(trackingTagBeforeHover?.width).toBe(72);
    expect.soft(trackingTagBeforeHover?.height).toBe(24);
    expect(
      await trackingTag.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await trackingTag.hover();
    await expect(trackingTag).toHaveText(/Untrack/);
    expect.soft(await trackingTag.boundingBox()).toEqual(trackingTagBeforeHover);
  });

  await test.step("viewing another tracked player moves the account to it", async () => {
    await page.getByTestId("current-player-button").click();
    await page
      .getByRole("dialog")
      .getByTestId(`tracked-player-row-${RECENT_PUUID}`)
      .getByRole("button", { name: "View" })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/player-overview\\?puuid=${RECENT_PUUID}`),
    );
    await expect(
      page.getByRole("button", { name: "Recent#TWO" }),
    ).toBeVisible();
    expect(state.syncStarts).toBe(0);
  });

  await test.step("an untracked player's toggle offers to track without resizing", async () => {
    const untrackedTag = trackingToggle(page);
    await expect(untrackedTag).toHaveText(/Untracked/);
    const untrackedTagBeforeHover = await untrackedTag.boundingBox();
    expect.soft(untrackedTagBeforeHover?.width).toBe(72);
    expect.soft(untrackedTagBeforeHover?.height).toBe(24);
    const untrackedTagMetrics = await untrackedTag.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(untrackedTagMetrics.scrollWidth).toBeLessThanOrEqual(
      untrackedTagMetrics.clientWidth,
    );
    await untrackedTag.hover();
    await expect(untrackedTag).toHaveText(/Track/);
    expect
      .soft(await untrackedTag.boundingBox())
      .toEqual(untrackedTagBeforeHover);
  });

  await test.step("choosing a player to analyze leaves the account alone", async () => {
    const currentBeforeLocalSelection = state.currentPuuid;
    const contextUpdatesBeforeLocalSelection = state.currentPlayerUpdates;
    await page.getByRole("link", { name: "Matchmaking Analysis" }).click();
    const analysisPlayerSearch = page.getByRole("combobox", {
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
      await expect
        .soft(labelParts.nth(0))
        .toHaveAttribute("style", "color: var(--color-muted-foreground);");
      await expect
        .soft(labelParts.nth(1))
        .toHaveAttribute("style", "color: var(--color-card-foreground);");
    }
    expect(state.currentPuuid).toBe(currentBeforeLocalSelection);
    expect(state.currentPlayerUpdates).toBe(
      contextUpdatesBeforeLocalSelection,
    );
    await expect(page.getByTestId("current-player-button")).toHaveText(
      /Recent#TWO/,
    );
  });
});

test("opens the tracked players dialog over the page without moving it", async ({
  page,
}) => {
  const state = await startAtPlayerOverview(page);
  const currentPlayerButton = page.getByTestId("current-player-button");
  const dialog = page.getByRole("dialog");

  await test.step("the sidebar row is the only way in on a desktop viewport", async () => {
    await expect(page.getByTestId("view-tracked-players-button")).toBeHidden();
    await expect(currentPlayerButton).toBeVisible();
    // Polled: a layout question read once answers before the browser has
    // finished laying the page out, which on a loaded runner is a coin toss.
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollHeight > innerHeight),
      )
      .toBe(true);
  });

  await test.step("opening it holds the page still and the URL unchanged", async () => {
    const rowBefore = await currentPlayerButton.boundingBox();
    const pageUrlBeforeDialog = page.url();
    await currentPlayerButton.click();
    expect(page.url()).toBe(pageUrlBeforeDialog);
    await expect(
      dialog.getByRole("heading", { name: "Tracked Players" }),
    ).toBeVisible();
    await expect(
      dialog.getByText("View, add or remove tracked players."),
    ).toBeVisible();
    const activeRowDuringDialog = await currentPlayerButton.boundingBox();
    expect
      .soft(Math.abs((activeRowDuringDialog?.x ?? 0) - (rowBefore?.x ?? 0)))
      .toBeLessThanOrEqual(0.5);
    const dialogBox = await dialog.boundingBox();
    const viewport = page.viewportSize();
    const topSpace = dialogBox?.y ?? 0;
    const bottomSpace =
      (viewport?.height ?? 0) - ((dialogBox?.y ?? 0) + (dialogBox?.height ?? 0));
    expect.soft(Math.abs(bottomSpace - topSpace * 2)).toBeLessThanOrEqual(2);
  });

  await test.step("it lists the tracked players and nothing it used to", async () => {
    await expect(dialog.getByText("Manage Tracked Players")).toHaveCount(0);
    await expect(dialog.getByLabel("Search tracked players")).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: /expand|collapse/i }),
    ).toHaveCount(0);
    await expect(dialog.getByRole("heading", { level: 3 })).toHaveCount(6);
  });

  await test.step("the list, not the dialog, is what scrolls", async () => {
    const scrollRegion = dialog.getByTestId("tracked-players-scroll-region");
    await expect(scrollRegion).toHaveClass(/overflow-y-auto/);
    expect(
      await scrollRegion.evaluate((element) => element.parentElement?.id),
    ).toBe("tracked-players");
    await expect
      .poll(() =>
        scrollRegion.evaluate(
          (element) => element.scrollHeight > element.clientHeight,
        ),
      )
      .toBe(true);
  });

  await test.step("a row's View action opens that player", async () => {
    await dialog
      .getByTestId(`tracked-player-row-${RECENT_PUUID}`)
      .getByRole("button", { name: "View" })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/player-overview\\?puuid=${RECENT_PUUID}`),
    );
    await expect(
      page.getByRole("button", { name: "Recent#TWO" }),
    ).toBeVisible();
    expect(state.syncStarts).toBe(0);
  });

  await test.step("it opens from match history without navigating", async () => {
    await page.getByRole("link", { name: "Match History" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/match-history\\?puuid=${RECENT_PUUID}`),
    );
    const matchHistoryUrl = page.url();
    await currentPlayerButton.click();
    expect(page.url()).toBe(matchHistoryUrl);
    await expect(
      dialog.getByRole("heading", { name: "Tracked Players" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
  });

  await test.step("a page that never scrolled gets no compensation", async () => {
    await page.setViewportSize({ width: 1440, height: 2000 });
    await page.getByRole("link", { name: "Player Overview" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/player-overview\\?puuid=${RECENT_PUUID}`),
    );
    // Polled especially here: a resize is asynchronous, so the first read can
    // land against the previous viewport.
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollHeight <= innerHeight,
        ),
      )
      .toBe(true);
    const noScrollBefore = await currentPlayerButton.boundingBox();
    await currentPlayerButton.click();
    await expect(
      dialog.getByRole("heading", { name: "Tracked Players" }),
    ).toBeVisible();
    const noScrollDuring = await currentPlayerButton.boundingBox();
    expect
      .soft(Math.abs((noScrollDuring?.x ?? 0) - (noScrollBefore?.x ?? 0)))
      .toBeLessThanOrEqual(0.5);
    await page.keyboard.press("Escape");
  });
});

test("filters, searches and pages the match history", async ({ page }) => {
  await startAtPlayerOverview(page, { currentPuuid: RECENT_PUUID });

  await test.step("it opens on ranked solo, 25 at a time", async () => {
    const matchHistoryNav = page.getByRole("link", { name: "Match History" });
    await expect(matchHistoryNav).toHaveAttribute(
      "href",
      `/match-history?puuid=${RECENT_PUUID}`,
    );
    const defaultMatchHistoryRequest = detailedMatchesRequest(
      page,
      RECENT_PUUID,
      { queues: "420", count: "25", start: "0" },
    );
    await matchHistoryNav.click();
    await defaultMatchHistoryRequest;
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
    await expect(
      page.getByText("10 total matches (6W / 4L) • 60% WR"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Ranked Solo/Duo" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Match history page size")).toContainText(
      "25",
    );
  });

  await page.setViewportSize({ width: 1440, height: 2000 });
  // Polled especially here: a resize is asynchronous, so the first read can
  // land against the previous viewport.
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollHeight > innerHeight),
    )
    .toBe(true);
  const matchCardBeforeFilter = await page
    .locator("#match-history")
    .boundingBox();

  await test.step("a queue button refetches, and shift adds a second queue", async () => {
    const mayhemRequest = detailedMatchesRequest(page, RECENT_PUUID, {
      queues: "2400",
    });
    await page.getByRole("button", { name: "ARAM: Mayhem" }).click();
    await mayhemRequest;
    await expect(
      page.getByRole("button", { name: "ARAM: Mayhem" }),
    ).toHaveAttribute("aria-pressed", "true");

    const queueUnionRequest = detailedMatchesRequest(page, RECENT_PUUID, {
      queues: "450,2400",
    });
    await page
      .getByRole("button", { name: "ARAM", exact: true })
      .click({ modifiers: ["Shift"] });
    await queueUnionRequest;
    await expect(
      page.getByRole("button", { name: "ARAM", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  const matchSearch = page.getByPlaceholder("Search for champion or player");

  await test.step("the search box asks the server, keeping the queues", async () => {
    await expect(matchSearch).toBeVisible();
    await expect
      .soft.poll(() =>
        matchSearch.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return { height: rect.height, width: rect.width };
        }),
      )
      .toEqual({ height: 28, width: 230 });
    const participantSearchRequest = detailedMatchesRequest(
      page,
      RECENT_PUUID,
      { queues: "450,2400", search: "Aurelion Sol" },
    );
    await matchSearch.fill("Aurelion Sol");
    await participantSearchRequest;
  });

  await test.step("the page size select does not lock the page", async () => {
    const scrollbarWidthBeforePageSize = await page.evaluate(
      () => innerWidth - document.documentElement.clientWidth,
    );
    await page.getByLabel("Match history page size").click();
    expect(
      await page.evaluate(() =>
        document.body.hasAttribute("data-scroll-locked"),
      ),
    ).toBe(false);
    expect
      .soft(
        await page.evaluate(
          () => innerWidth - document.documentElement.clientWidth,
        ),
      )
      .toBe(scrollbarWidthBeforePageSize);

    const pageSizeRequest = detailedMatchesRequest(page, RECENT_PUUID, {
      count: "100",
      start: "0",
    });
    await page.getByRole("option", { name: "100", exact: true }).click();
    await pageSizeRequest;
    await expect(page.getByText("Showing 0 to 0 of 0 matches")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Previous page" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Next page" }),
    ).toBeDisabled();

    const matchCardAfterFilter = await page
      .locator("#match-history")
      .boundingBox();
    expect
      .soft(
        Math.abs(
          (matchCardAfterFilter?.x ?? 0) - (matchCardBeforeFilter?.x ?? 0),
        ),
      )
      .toBeLessThanOrEqual(0.5);
  });

  await test.step("a reload restores the queues and the page size", async () => {
    await matchSearch.fill("");
    const restoredMatchHistoryRequest = detailedMatchesRequest(
      page,
      RECENT_PUUID,
      {
        queues: "450,2400",
        count: "100",
        start: "0",
        search: null,
      },
    );
    await page.reload();
    await restoredMatchHistoryRequest;
    await expect(
      page.getByRole("button", { name: "ARAM", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("button", { name: "ARAM: Mayhem" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Match history page size")).toContainText(
      "100",
    );
  });

  await test.step("the way back carries the player", async () => {
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
  });
});

test("marks the active route and reaches every sidebar destination", async ({
  page,
}) => {
  await startAtPlayerOverview(page);

  await test.step("quick navigation lists only the sections this page has", async () => {
    await page.getByRole("button", { name: "Open page navigation" }).hover();
    await expect(
      page.getByRole("navigation", { name: "Page sections" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Player Summary" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Match History" }),
    ).toHaveCount(0);
  });

  const playerOverviewNav = page.getByRole("link", { name: "Player Overview" });
  let overviewNavStyle = {
    borderLeftColor: "",
    borderLeftWidth: "",
    transitionProperty: "",
  };
  let overviewTextX = 0;

  await test.step("the active entry wears the accent border", async () => {
    await expect
      .soft.poll(() =>
        playerOverviewNav.evaluate(
          (element) => getComputedStyle(element).borderLeftColor,
        ),
      )
      .toBe("rgb(207, 169, 58)");
    overviewTextX =
      (await playerOverviewNav.locator("span").boundingBox())?.x ?? 0;
    overviewNavStyle = await playerOverviewNav.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        borderLeftColor: style.borderLeftColor,
        borderLeftWidth: style.borderLeftWidth,
        transitionProperty: style.transitionProperty,
      };
    });
  });

  await test.step("home wears the same one, to the pixel", async () => {
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
      .soft.poll(() =>
        homeNav.evaluate(
          (element) => getComputedStyle(element).borderLeftColor,
        ),
      )
      .toBe("rgb(207, 169, 58)");
    const homeTextX = (await homeNav.locator("span").boundingBox())?.x ?? 0;
    const homeNavStyle = await homeNav.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        borderLeftColor: style.borderLeftColor,
        borderLeftWidth: style.borderLeftWidth,
        transitionProperty: style.transitionProperty,
      };
    });
    expect.soft(homeNavStyle.borderLeftWidth).toBe("4px");
    expect
      .soft(homeNavStyle.borderLeftColor)
      .toBe(overviewNavStyle.borderLeftColor);
    expect
      .soft(homeNavStyle.transitionProperty)
      .toBe(overviewNavStyle.transitionProperty);
    expect(homeNavStyle.transitionProperty).not.toBe("all");
    expect.soft(Math.abs(homeTextX - overviewTextX)).toBeLessThanOrEqual(0.5);
  });

  await test.step("matchmaking analysis renders its own page", async () => {
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
  });

  await test.step("settings renders only the account section", async () => {
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
  });
});
