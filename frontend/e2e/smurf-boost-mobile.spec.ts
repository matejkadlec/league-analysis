import { expect, test } from "@playwright/test";

import { acceptCookieBanner } from "./support/auth";
import { installSmurfBoostMocks, PUUID } from "./support/smurf-boost-harness";

/**
 * The page is read on a phone, and its result carries the widest content in the
 * feature. A six-column table needs roughly 450px of intrinsic width, which is
 * wider than the viewport this suite emulates.
 *
 * `main` in the app shell is a flex item with the default `min-width: auto`, so
 * it does not shrink below its content: anything too wide stretches the whole
 * document instead of scrolling inside its own card. That makes a wide result a
 * page-level defect rather than a local one, which is why the width assertion
 * below is on the document.
 */

const PHONE = { width: 390, height: 844 };

test.describe("smurf and boost detection on a phone", () => {
  test.use({ viewport: PHONE });

  test("never scrolls the page sideways, before or after a comparison", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await installSmurfBoostMocks(page);

    await page.goto(`/rank-manipulation?puuid=${PUUID}`);
    await acceptCookieBanner(page);

    const documentWidth = () =>
      page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));

    const before = await documentWidth();
    expect(before.scrollWidth, "page overflows before a result").toBe(
      before.clientWidth,
    );

    await page.getByRole("button", { name: "Run the comparison" }).click();
    await expect(page.locator("#smurf-boost-result")).toBeVisible();

    const after = await documentWidth();
    expect(after.scrollWidth, "the result stretches the page").toBe(
      after.clientWidth,
    );
  });

  test("stacks each measurement instead of hiding columns behind a swipe", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await installSmurfBoostMocks(page);

    await page.goto(`/rank-manipulation?puuid=${PUUID}`);
    await acceptCookieBanner(page);
    await page.getByRole("button", { name: "Run the comparison" }).click();

    const result = page.locator("#smurf-boost-result");
    await expect(result).toBeVisible();

    // The table is the desktop presentation and must not be the one on show.
    // There is one per family, and neither may be visible here.
    const tables = result.locator("table");
    await expect(tables).toHaveCount(2);
    for (const table of await tables.all()) {
      await expect(table).toBeHidden();
    }

    const blocks = result.locator(
      "[data-testid^='smurf-boost-measurements-stacked-'] > li",
    );
    await expect(blocks).toHaveCount(6);

    // The threshold and the outcome are what make a value mean anything, so
    // both have to be readable without a horizontal gesture.
    const first = blocks.first();
    await expect(first).toBeVisible();
    await expect(first.getByText("Above threshold")).toBeVisible();
    // The figure labels are exact, because "Threshold" is also a substring of
    // the outcome badge sitting directly above them.
    await expect(first.locator("dt")).toHaveText([
      "Value",
      "Threshold",
      "Games",
    ]);
    await expect(first.locator("dd")).toHaveText(["1.45", "1.20", "20"]);

    // An unmeasurable area keeps its reason in the stacked layout too.
    await expect(
      blocks
        .filter({ hasText: "Not available" })
        .getByText("No recent game was on a rarely played champion."),
    ).toBeVisible();
  });

  test("keeps the settings form usable at one field per row", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await installSmurfBoostMocks(page);

    await page.goto(`/rank-manipulation?puuid=${PUUID}`);
    await acceptCookieBanner(page);

    // The settings live in a dialog, so the phone check opens it first.
    await page
      .getByRole("button", { name: "Detection Settings", exact: true })
      .click();

    const field = page.getByLabel("Recent games compared");
    await expect(field).toBeVisible();

    // A number input narrower than about 200px on a phone means the grid did
    // not collapse to a single column.
    const box = await field.boundingBox();
    expect(box, "the threshold input has no layout box").not.toBeNull();
    expect(box?.width ?? 0).toBeGreaterThan(200);

    // Editing still validates against the backend's range on a phone.
    await field.fill("9");
    await expect(
      page.getByText("Recent games compared must be between 10 and 50."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save thresholds" }),
    ).toBeDisabled();
  });
});
