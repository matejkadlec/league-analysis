import { expect, test } from "@playwright/test";

import { installSmurfBoostMocks, PUUID } from "./support/smurf-boost-harness";

/** Words `docs/smurf-boost-detection.md` forbids in the rendered page. */
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
  await page.getByRole("button", { name: "Accept necessary" }).click();

  // The sidebar entry keeps the selected player, like the other player pages.
  const navigationLink = page.getByRole("link", {
    name: "Smurf & Boost Detection",
  });
  await expect(navigationLink).toHaveAttribute(
    "href",
    `/smurf-boost-detection?puuid=${PUUID}`,
  );
  await navigationLink.click();
  await expect(page).toHaveURL(
    new RegExp(`/smurf-boost-detection\\?puuid=${PUUID}`),
  );

  await expect(page.locator("#smurf-boost-explanation")).toBeVisible();
  await expect(page.locator("#smurf-boost-settings")).toBeVisible();

  // The stored settings match the shipped preset, and every threshold is
  // offered with the range the backend enforces.
  const settingsCard = page.locator("#smurf-boost-settings");
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

  await expect(page.locator("#smurf-boost-run")).toBeVisible();
  await expect(page.locator("#smurf-boost-result")).toHaveCount(0);

  await page.getByRole("button", { name: "Run the comparison" }).click();

  const result = page.locator("#smurf-boost-result");
  await expect(result).toBeVisible();
  expect(api.analyzeCalls).toBe(1);

  // Each family carries its own band, and neither is summarised as a number.
  await expect(result.getByText("Rapid improvement pattern")).toBeVisible();
  await expect(result.getByText("Notable indicators")).toBeVisible();
  await expect(result.getByText("Playing pattern change")).toBeVisible();
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
