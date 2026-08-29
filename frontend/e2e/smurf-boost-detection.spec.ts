import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { acceptCookieBanner } from "./support/auth";
import {
  installSmurfBoostMocks,
  OTHER_PUUID,
  PUUID,
} from "./support/smurf-boost-harness";

/** Words the model's result wording forbids in the rendered page. */
const FORBIDDEN = [
  "smurf detected",
  "likely boosted",
  "suspicious",
  "clean",
  "legitimate",
  "verified",
  "confirmed",
  "probability",
];

/**
 * `innerText` reads only laid-out text, so a hidden panel or closed dialog
 * escapes it; callers run this once per visible state. `textContent` would see
 * them but also script payloads, where "clean" matches "cleanup".
 */
async function expectNoForbiddenWording(page: Page, stage: string) {
  const text = (await page.locator("body").innerText()).toLowerCase();
  for (const word of FORBIDDEN) {
    expect(text, `${stage}: page must not contain "${word}"`).not.toContain(
      word,
    );
  }
}

test("runs a comparison and reports both families without accusing anyone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });

  const api = await installSmurfBoostMocks(page);

  await page.goto("/player-overview");
  await acceptCookieBanner(page);

  // The sidebar entry carries no player, unlike the other player pages: this
  // page's `?puuid=` is a local analysis target, and a link that handed it the
  // account's current player would make every visit overwrite that target.
  const navigationLink = page.getByRole("link", { name: "Rank Manipulation" });
  await expect(navigationLink).toHaveAttribute("href", "/rank-manipulation");
  await navigationLink.click();

  // The page seeds its own local target from the current player instead.
  await expect(page).toHaveURL(
    new RegExp(`/rank-manipulation\\?puuid=${PUUID}`),
  );

  await expect(page.locator("#smurf-boost-explanation")).toBeVisible();

  // The settings live behind a button now, not in the page flow.
  await expect(page.locator("#smurf-boost-settings")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Detection Settings", exact: true })
    .click();

  // The stored settings match the shipped preset, and every threshold is
  // offered with the range the backend enforces.
  const settingsCard = page.locator("#smurf-boost-settings");
  await expect(settingsCard).toBeVisible();
  await expect(settingsCard.getByText("Shipped defaults")).toBeVisible();
  await expect(
    page.getByTestId("smurf-boost-preset-conservative"),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Recent games compared")).toHaveValue("20");
  await expect(page.getByText("Allowed: 10 to 50.")).toBeVisible();
  await expectNoForbiddenWording(page, "settings dialog, Games Compared tab");

  // A value the backend would reject never reaches it. The field lives in
  // the Playing Pattern Change tab, so reaching it means opening that tab.
  await page.getByRole("tab", { name: "Playing Pattern Change" }).click();
  await page.getByLabel("B3 share counted as a tail").fill("0.9");
  await expect(
    page.getByText("B3 share counted as a tail must be between 0.15 and 0.4."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save thresholds" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expectNoForbiddenWording(
    page,
    "settings dialog, Playing Pattern Change tab",
  );
  await page.getByRole("tab", { name: "Rapid Improvement Pattern" }).click();
  await expectNoForbiddenWording(
    page,
    "settings dialog, Rapid Improvement Pattern tab",
  );

  // Applying a preset sends only the fields the write contract accepts.
  await page.getByTestId("smurf-boost-preset-sensitive").click();
  await expect(settingsCard.getByText("Your settings")).toBeVisible();
  await expect(page.getByLabel("Recent games compared")).toHaveValue("15");
  // `written` is filled inside the route handler, which the checker cannot see.
  const writtenBody = api.written as unknown as {
    settings: Record<string, unknown>;
  } | null;
  expect(writtenBody).not.toBeNull();
  expect(writtenBody?.settings.queueId).toBeUndefined();
  expect(Object.keys(writtenBody?.settings ?? {}).length).toBe(15);

  await page.getByRole("button", { name: "Reset to defaults" }).click();
  await expect(settingsCard.getByText("Shipped defaults")).toBeVisible();
  await expect(page.getByLabel("Recent games compared")).toHaveValue("20");

  // Closing the dialog removes the settings from the page entirely.
  await page.keyboard.press("Escape");
  await expect(settingsCard).toHaveCount(0);

  const runCard = page.locator("#smurf-boost-run");
  await expect(runCard).toBeVisible();
  await expect(
    runCard.getByRole("heading", { name: "Games Comparison" }),
  ).toBeVisible();
  // The target is chosen here, in the card, rather than in the left sidebar.
  await expect(
    runCard.getByLabel("Choose player for comparison"),
  ).toBeVisible();
  await expect(page.locator("#smurf-boost-result")).toHaveCount(0);

  // Quick navigation offers only what is on the page: before a comparison
  // there is no result section, so there is no entry pointing at one.
  const quickNavigation = page.getByTestId("section-quick-navigation");
  await quickNavigation.hover();
  await expect(
    quickNavigation.getByRole("button", { name: "Games Comparison" }),
  ).toBeVisible();
  await expect(
    quickNavigation.getByRole("button", { name: "Result" }),
  ).toHaveCount(0);

  // The panel is sized by its entries, while the tab that opens it keeps the
  // fixed rail height. Measured rather than asserted on a class, so a future
  // height lands here rather than passing silently.
  const panel = quickNavigation.getByRole("navigation", {
    name: "Page sections",
  });
  const panelBox = await panel.boundingBox();
  // Scoped to the panel: the rail's own open/close control is a button too,
  // and counting it would loosen the bound below by a whole entry.
  const entryCount = await panel.getByRole("button").count();
  // Measured: three entries render 132px, against the 242px the fixed rail
  // height used to force. ~40px an entry plus the nav's `py-2`, loose enough
  // to survive a font change, tight enough that a return to 242px lands here.
  expect(panelBox!.height).toBeLessThanOrEqual(entryCount * 40 + 16 + 8);

  await page.getByRole("button", { name: "Run the comparison" }).click();

  // The click fetches this player's games from Riot before comparing them,
  // so a player the scheduled Match Fetcher has not reached yet is not
  // compared on a stale history. The comparison waits for the fetch.
  await expect(
    page.getByText("Fetching this player's games from Riot", { exact: false }),
  ).toBeVisible();
  expect(api.analyzeCalls).toBe(0);

  const result = page.locator("#smurf-boost-result");
  await expect(result).toBeVisible();
  expect(api.analyzeCalls).toBe(1);
  expect(api.synced).toEqual([PUUID]);

  await quickNavigation.hover();
  await expect(
    quickNavigation.getByRole("button", { name: "Result" }),
  ).toBeVisible();

  // Each family carries its own band, worded on its tab so both verdicts
  // stay visible whichever tab is chosen -- and neither is a number. The
  // accessible name pairs the family with its own reading.
  await expect(
    result.getByRole("tab", {
      name: "Rapid Improvement Pattern Notable indicators",
    }),
  ).toBeVisible();
  await expect(
    result.getByRole("tab", {
      name: "Playing Pattern Change No unusual pattern",
    }),
  ).toBeVisible();
  await expect(result.getByText("High confidence")).toBeVisible();

  // A stored result always says who it describes.
  await expect(
    result.getByTestId("smurf-boost-result-player"),
  ).toHaveText("Comparison#ONE");

  // An area that could not be measured stays visible with its reason, and a
  // measured area shows its figures beside the drawn meter.
  const measurements = result.locator(
    "[data-testid^='smurf-boost-measurements-']",
  );
  await expect(measurements).toHaveCount(2);
  await expect(measurements.getByText("Not available")).toBeVisible();
  await expect(
    measurements.getByText("No recent game was on a rarely played champion."),
  ).toBeVisible();
  await expect(measurements.first().getByText("1.45 / 1.20")).toBeVisible();

  // The other family's measurements sit behind its tab, not lost.
  await expect(measurements.last().getByText("B1")).toBeHidden();
  await expectNoForbiddenWording(page, "result, Rapid Improvement tab");
  await result
    .getByRole("tab", { name: "Playing Pattern Change No unusual pattern" })
    .click();
  await expect(measurements.last().getByText("B1")).toBeVisible();

  await expect(
    result.getByText("Do not use it to accuse anyone.", { exact: false }),
  ).toBeVisible();

  await expectNoForbiddenWording(page, "result, Playing Pattern Change tab");

  // A family reading is a word, never a number. A win rate inside a signal row
  // may still be a percentage, so the digit check is scoped to the band.
  const bands = page.locator("[data-testid^='smurf-boost-band-']");
  await expect(bands).toHaveCount(2);
  for (const band of await bands.all()) {
    await expect(band).not.toHaveText(/\d/);
  }

  // The stored result is read back on a fresh visit rather than re-run.
  await page.reload();
  await expect(page.locator("#smurf-boost-result")).toBeVisible();
  expect(api.analyzeCalls).toBe(1);
  await expect(
    page.getByRole("button", { name: "Run the comparison again" }),
  ).toBeVisible();
});

test("renders the page at the sizes the layout was specified in", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });

  await installSmurfBoostMocks(page);

  await page.goto(`/rank-manipulation?puuid=${PUUID}`);
  await acceptCookieBanner(page);


  // The settings live in a dialog; open it before measuring anything inside.
  await page
    .getByRole("button", { name: "Detection Settings", exact: true })
    .click();

  // Muted helper copy was 12px against a dark background. Measured rather
  // than asserted as class names: a utility that stops resolving still leaves
  // the class in the markup.
  const helper = page.locator("#smurf-boost-recentWindowSize-help");
  await expect(helper).toBeVisible();
  await expect(helper).toHaveCSS("font-size", "14px");

  const presetDescription = page
    .getByTestId("smurf-boost-preset-conservative")
    .locator("span")
    .last();
  await expect(presetDescription).toHaveCSS("font-size", "14px");

  // Section headers inside Detection Settings carry the shared 16px title
  // treatment, so they read as sections rather than as another field label.
  for (const heading of ["Presets", "Thresholds"]) {
    const section = page
      .locator("#smurf-boost-settings")
      .getByRole("heading", { name: heading, exact: true });
    await expect(section, heading).toHaveCSS("font-size", "16px");
  }

  // Counting the resolved template catches a breakpoint that never applies,
  // which a class-name check cannot. Each threshold group sizes its own grid so
  // every tab fits without scrolling the dialog.
  const columnsOf = (testId: string) =>
    page
      .getByTestId(testId)
      .evaluate(
        (element) =>
          getComputedStyle(element).gridTemplateColumns.split(" ").length,
      );
  await expect
    .poll(() => columnsOf("smurf-boost-thresholds-windows"))
    .toBe(2);
  await page.getByRole("tab", { name: "Playing Pattern Change" }).click();
  await expect.poll(() => columnsOf("smurf-boost-thresholds-pattern")).toBe(4);

  // The point of the grouped layout: with its tallest tab open, the dialog
  // holds everything at desktop size without scrolling itself. Measured on
  // the scroll container, not asserted from a class.
  const dialogScroll = await page
    .locator("#smurf-boost-settings")
    .evaluate((element) => ({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    }));
  expect(dialogScroll.scrollHeight).toBeLessThanOrEqual(
    dialogScroll.clientHeight,
  );

  // And that height is the same on every tab: all three groups occupy one
  // grid cell, so a shorter group must not shrink the dialog and move the
  // tab row out from under the pointer between clicks.
  const dialogHeight = async () =>
    (await page.locator("#smurf-boost-settings").boundingBox())!.height;
  const tallestTabHeight = await dialogHeight();
  await page.getByRole("tab", { name: "Games Compared" }).click();
  // Polled, not read once: `click()` awaits actionability but not React's
  // commit or the layout that follows, so a single read measures whichever
  // height happened to be current.
  await expect.poll(dialogHeight).toBe(tallestTabHeight);

  await page.keyboard.press("Escape");
  await expect(page.locator("#smurf-boost-settings")).toHaveCount(0);

  // Games Comparison takes half the content width, and the other half is left
  // empty on purpose.
  const runCard = page.locator("#smurf-boost-run");
  const row = page.locator("#smurf-boost-comparison-row");
  // Counted before it is measured: `boundingBox()` on a locator that matches
  // nothing waits out the whole timeout instead of saying what is missing.
  await expect(row).toHaveCount(1);
  const runBox = await runCard.boundingBox();
  const rowBox = await row.boundingBox();
  expect(runBox).not.toBeNull();
  expect(rowBox).not.toBeNull();
  expect(runBox!.width / rowBox!.width).toBeGreaterThan(0.4);
  expect(runBox!.width / rowBox!.width).toBeLessThan(0.55);

  // The sidebar label is short enough to stay on one line at desktop width.
  const label = page
    .getByRole("link", { name: "Rank Manipulation" })
    .locator("span");
  const labelBox = await label.boundingBox();
  const lineHeight = await label.evaluate(
    (element) => Number.parseFloat(getComputedStyle(element).lineHeight) || 24,
  );
  expect(labelBox).not.toBeNull();
  expect(labelBox!.height).toBeLessThanOrEqual(lineHeight + 1);
});

/**
 * The reason the page has a search of its own: analysing somebody who is not
 * the account's player, without becoming them. The other spec asserts only
 * that the control is on screen.
 */
test("compares a player the account has never tracked, and stays itself", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });

  const api = await installSmurfBoostMocks(page);

  await page.goto("/rank-manipulation");
  await acceptCookieBanner(page);
  await expect(page.locator("#smurf-boost-run")).toBeVisible();

  const currentPlayer = page.getByTestId("current-player-button");
  await expect(currentPlayer).toHaveText("Comparison#ONE");

  // The stranger is reachable only through the suggestion endpoint: the
  // tracked list this account has holds one player, and it is not them.
  const search = page
    .locator("#smurf-boost-run")
    .getByLabel("Choose player for comparison");
  await search.fill("Stranger");
  await page.getByRole("option", { name: /Stranger#TWO/ }).click();

  await expect(page).toHaveURL(
    new RegExp(`/rank-manipulation\\?puuid=${OTHER_PUUID}`),
  );

  await page.getByRole("button", { name: "Run the comparison" }).click();
  await expect(page.locator("#smurf-boost-result")).toBeVisible();
  // Aimed at the stranger, not at whoever the sidebar holds -- and the games
  // fetched are the stranger's too.
  expect(api.analyzed).toEqual([OTHER_PUUID]);
  expect(api.synced).toEqual([OTHER_PUUID]);

  // The search keeps the chosen player rather than emptying itself, so the
  // box still says who the result on screen is about.
  await expect(search).toHaveValue("Stranger#TWO");

  // And the account is untouched. Picking in the sidebar would have written
  // this player in as the current one; picking in the card must not.
  await expect(currentPlayer).toHaveText("Comparison#ONE");

  // The same control also lives in the 240px sidebar, where the readability
  // pass raised its suggestions from 12px. Two lines is the ceiling there --
  // a third would push the list past the fold on the shortest laptop.
  const sidebarSearch = page.getByLabel("Search for player");
  await sidebarSearch.fill("Stranger");
  const suggestion = page.getByRole("option", { name: /Stranger#TWO/ });
  const box = await suggestion.boundingBox();
  const lineHeight = await suggestion.evaluate(
    (element) => Number.parseFloat(getComputedStyle(element).lineHeight) || 20,
  );
  expect(box).not.toBeNull();
  // 16px is the button's own vertical padding (py-2).
  expect(box!.height).toBeLessThanOrEqual(lineHeight * 2 + 16 + 1);
});

test("does not carry one player's fetch report onto another", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });

  await installSmurfBoostMocks(page);
  await page.goto("/rank-manipulation");
  await acceptCookieBanner(page);

  const runCard = page.locator("#smurf-boost-run");
  await page.getByRole("button", { name: "Run the comparison" }).click();
  await expect(page.locator("#smurf-boost-result")).toBeVisible();
  await expect(runCard).toContainText("The last fetch");

  // The card holds that sentence in its own state, where no query key can
  // invalidate it, so the `key` on this card is the whole mechanism: without it
  // React keeps the instance and the stranger inherits a fetch nobody ran.
  const search = runCard.getByLabel("Choose player for comparison");
  await search.fill("Stranger");
  await page.getByRole("option", { name: /Stranger#TWO/ }).click();
  await expect(page).toHaveURL(
    new RegExp(`/rank-manipulation\\?puuid=${OTHER_PUUID}`),
  );

  await expect(runCard).toContainText("Ranked solo games stored:");
  await expect(runCard).not.toContainText("The last fetch");
});

test("seeds the card's search with the first player an empty account picks", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });

  // The account that has never chosen a player: the one state where the card's
  // `key` does real work. `PlayerSelector` starts with an empty
  // `initialSearchValue` here, so only the remount re-seeds the box.
  await installSmurfBoostMocks(page, { currentPlayer: null });

  await page.goto("/rank-manipulation");
  await acceptCookieBanner(page);

  const search = page
    .locator("#smurf-boost-run")
    .getByLabel("Choose player for comparison");
  await expect(search).toHaveValue("");

  await search.fill("Stranger");
  await page.getByRole("option", { name: /Stranger#TWO/ }).click();

  await expect(page).toHaveURL(
    new RegExp(`/rank-manipulation\\?puuid=${OTHER_PUUID}`),
  );
  await expect(search).toHaveValue("Stranger#TWO");
});

/**
 * `accessibility.spec.ts` scans the three routes the populated-player harness
 * serves; Rank Manipulation runs on its own fixtures, so its scan lives here.
 * The result card is included on purpose -- a scan of an unrun page misses it.
 */
test("has no WCAG A/AA violations, before or after a comparison", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });

  await installSmurfBoostMocks(page);
  await page.goto(`/rank-manipulation?puuid=${PUUID}`);
  await acceptCookieBanner(page);
  await expect(page.locator("#smurf-boost-run")).toBeVisible();

  const scan = async (stage: string) => {
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const readable = results.violations.flatMap((violation) =>
      violation.nodes.map(
        (node) => `${violation.id}: ${violation.help} -> ${node.html}`,
      ),
    );
    expect(readable, stage).toEqual([]);
  };

  await scan("before the comparison");

  // The settings form moved into a dialog, so it needs its own pass -- a
  // scan of the closed page never reaches it.
  await page
    .getByRole("button", { name: "Detection Settings", exact: true })
    .click();
  await expect(page.locator("#smurf-boost-settings")).toBeVisible();
  await scan("with the settings dialog open");
  // An inactive threshold group is visibility-hidden and axe skips it, so
  // each group's fields are only ever scanned with their own tab active.
  for (const tab of ["Rapid Improvement Pattern", "Playing Pattern Change"]) {
    await page.getByRole("tab", { name: tab }).click();
    await scan(`with the settings dialog open: ${tab}`);
  }
  await page.keyboard.press("Escape");
  await expect(page.locator("#smurf-boost-settings")).toHaveCount(0);

  await page.getByRole("button", { name: "Run the comparison" }).click();
  await expect(page.locator("#smurf-boost-result")).toBeVisible();

  // The success toast is scanned once it has finished fading in: axe measures
  // whatever opacity it finds, and the exclusion this replaces was hiding a
  // `color-contrast` failure recorded at opacity 0.03 mid-animation.
  await expect(page.locator("[data-sonner-toast]")).toHaveCSS("opacity", "1");

  await scan("with a result on screen");

  // The second family's measurements only exist for axe once their tab is
  // active. Scanned after the toast has left, so a mid-fade toast cannot
  // record a contrast reading at partial opacity.
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, {
    timeout: 15_000,
  });
  await page
    .locator("#smurf-boost-result")
    .getByRole("tab", { name: /Playing Pattern Change/ })
    .click();
  await scan("with the second family's measurements open");
});
