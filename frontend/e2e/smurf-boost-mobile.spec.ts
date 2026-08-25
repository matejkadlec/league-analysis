import { expect, test } from "@playwright/test";

import { acceptCookieBanner } from "./support/auth";
import { installSmurfBoostMocks, PUUID } from "./support/smurf-boost-harness";

/**
 * The result carries the widest content in the feature -- a six-column table
 * needs roughly 450px against the 390px viewport this suite emulates. `main`
 * has default `min-width: auto`, so too-wide content stretches the document.
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

  test("keeps every measurement readable without a sideways gesture", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await installSmurfBoostMocks(page);

    await page.goto(`/rank-manipulation?puuid=${PUUID}`);
    await acceptCookieBanner(page);
    await page.getByRole("button", { name: "Run the comparison" }).click();

    const result = page.locator("#smurf-boost-result");
    await expect(result).toBeVisible();

    const blocks = result.locator(
      "[data-testid^='smurf-boost-measurements-'] > li",
    );
    await expect(blocks).toHaveCount(6);

    // The threshold and the outcome are what make a value mean anything, so
    // both have to be readable without a horizontal gesture.
    const first = blocks.first();
    await expect(first).toBeVisible();
    await expect(first.getByText("Above threshold")).toBeVisible();
    await expect(first.getByText("1.45 / 1.20")).toBeVisible();
    await expect(first.getByText("20 games")).toBeVisible();

    // An unmeasurable area keeps its reason on a phone too.
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
