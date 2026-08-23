import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

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

test("runs a comparison and reports both families without accusing anyone", async ({
  page,
}) => {
  test.setTimeout(60_000);
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

  // A value the backend would reject never reaches it.
  await page.getByLabel("B3 share counted as a tail").fill("0.9");
  await expect(
    page.getByText("B3 share counted as a tail must be between 0.15 and 0.4."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save thresholds" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Discard changes" }).click();

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
  // fixed rail height. Stretching the panel to the rail left about 100px of
  // empty card under a three-entry list. Measured rather than asserted on a
  // class, so a future height lands here rather than passing silently.
  const panel = quickNavigation.getByRole("navigation", {
    name: "Page sections",
  });
  const panelBox = await panel.boundingBox();
  // Scoped to the panel: the rail's own open/close control is a button too,
  // and counting it would loosen the bound below by a whole entry.
  const entryCount = await panel.getByRole("button").count();
  // Measured: three entries render 132px, against the 242px the fixed rail
  // height used to force. ~40px an entry plus the nav's `py-2`, with a little
  // slack -- loose enough to survive a font change, tight enough that a
  // return to 242px lands here.
  expect(panelBox!.height).toBeLessThanOrEqual(entryCount * 40 + 16 + 8);

  await page.getByRole("button", { name: "Run the comparison" }).click();

  const result = page.locator("#smurf-boost-result");
  await expect(result).toBeVisible();
  expect(api.analyzeCalls).toBe(1);

  await quickNavigation.hover();
  await expect(
    quickNavigation.getByRole("button", { name: "Result" }),
  ).toBeVisible();

  // Each family carries its own band, and neither is summarised as a number.
  await expect(result.getByText("Rapid Improvement Pattern")).toBeVisible();
  await expect(result.getByText("Notable indicators")).toBeVisible();
  await expect(result.getByText("Playing Pattern Change")).toBeVisible();
  await expect(result.getByText("No unusual pattern")).toBeVisible();
  await expect(result.getByText("High confidence")).toBeVisible();

  // An area that could not be measured stays visible with its reason. Each
  // measurement is rendered twice — a table at this width and stacked blocks
  // below `sm` — so a signal-level assertion names the layout it is checking.
  const measurements = result.locator("table");
  await expect(measurements.getByText("Not available")).toBeVisible();
  await expect(
    measurements.getByText("No recent game was on a rarely played champion."),
  ).toBeVisible();
  // The stacked layout carries the same measurement and stays hidden here.
  // `toBeHidden` also passes on a locator that matches nothing, so the count
  // is asserted first — otherwise deleting the stacked layout would read as a
  // pass.
  const stacked = result.locator(
    "[data-testid^='smurf-boost-measurements-stacked-']",
  );
  await expect(stacked).toHaveCount(2);
  await expect(stacked.getByText("Not available")).toBeHidden();

  await expect(
    result.getByText("Do not use it to accuse anyone.", { exact: false }),
  ).toBeVisible();

  const pageText = (await page.locator("body").innerText()).toLowerCase();
  for (const word of FORBIDDEN) {
    expect(pageText, `page must not contain "${word}"`).not.toContain(word);
  }

  // A family reading is a word, never a number. A win rate inside a signal row
  // may still be a percentage, so the digit check is scoped to the band.
  const bands = page.locator("[data-testid^='smurf-boost-band-']");
  await expect(bands).toHaveCount(2);
  for (const band of await bands.all()) {
    expect(await band.innerText()).not.toMatch(/\d/);
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
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 1000 });

  await installSmurfBoostMocks(page);

  await page.goto(`/rank-manipulation?puuid=${PUUID}`);
  await acceptCookieBanner(page);

  const fontSize = (locator: ReturnType<typeof page.locator>) =>
    locator.evaluate((element) => getComputedStyle(element).fontSize);

  // The settings live in a dialog; open it before measuring anything inside.
  await page
    .getByRole("button", { name: "Detection Settings", exact: true })
    .click();

  // Muted helper copy was 12px against a dark background, which is the whole
  // complaint the readability ticket opens with. These are measured rather
  // than asserted as class names: a utility that stops resolving still leaves
  // the class in the markup.
  const helper = page.locator("#smurf-boost-recentWindowSize-help");
  await expect(helper).toBeVisible();
  expect(await fontSize(helper)).toBe("14px");

  const presetDescription = page
    .getByTestId("smurf-boost-preset-conservative")
    .locator("span")
    .last();
  expect(await fontSize(presetDescription)).toBe("14px");

  // Section headers inside Detection Settings carry the shared 16px title
  // treatment, so they read as sections rather than as another field label.
  for (const heading of ["Presets", "Thresholds"]) {
    const section = page
      .locator("#smurf-boost-settings")
      .getByRole("heading", { name: heading, exact: true });
    expect(await fontSize(section), heading).toBe("16px");
  }

  // Three threshold columns at desktop width. Counting the resolved template
  // catches a breakpoint that never applies, which a class-name check cannot.
  const columns = await page
    .locator("#smurf-boost-thresholds-grid")
    .evaluate(
      (element) =>
        getComputedStyle(element).gridTemplateColumns.split(" ").length,
    );
  expect(columns).toBe(3);

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
 * the account's player, without becoming that player.
 *
 * Nothing else covers it. The other spec asserts the control is on screen and
 * stops there, which passed just as well when choosing a player meant leaving
 * for Player Overview.
 */
test("compares a player the account has never tracked, and stays itself", async ({
  page,
}) => {
  test.setTimeout(60_000);
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
  // Aimed at the stranger, not at whoever the sidebar holds.
  expect(api.analyzed).toEqual([OTHER_PUUID]);

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

/**
 * `accessibility.spec.ts` scans the three routes the populated-player harness
 * serves; Rank Manipulation runs on its own fixtures, so its scan lives here.
 * The result card is included on purpose -- it is the widest, densest markup
 * in the feature and the part a scan of an unrun page would never reach.
 */
test("has no WCAG A/AA violations, before or after a comparison", async ({
  page,
}) => {
  test.setTimeout(60_000);
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
  await page.keyboard.press("Escape");
  await expect(page.locator("#smurf-boost-settings")).toHaveCount(0);

  await page.getByRole("button", { name: "Run the comparison" }).click();
  await expect(page.locator("#smurf-boost-result")).toBeVisible();

  // The success toast is scanned rather than excluded, but only once it has
  // finished fading in. Axe measures whatever opacity it finds, and the
  // exclusion this replaces was hiding a `color-contrast` failure recorded at
  // opacity 0.03 mid-animation -- the settled colours are near-black on a
  // pale tint.
  await expect(page.locator("[data-sonner-toast]")).toHaveCSS("opacity", "1");

  await scan("with a result on screen");
});
