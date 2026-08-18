import { expect, test } from "@playwright/test";

import {
  installPopulatedPlayerMocks,
  PUUID,
} from "./support/populated-player-harness";

/**
 * `main` in the app shell is a flex item, so content wider than the viewport
 * stretches the whole document rather than scrolling inside its own card. A
 * table that needs 460px on a 390px phone therefore reads as a page-level
 * defect, which is why the assertion is on the document.
 *
 * The fixtures matter as much as the viewport: measured against an empty
 * database every one of these routes reports exactly 390, because none of the
 * wide descendants render without rows to put in them.
 */

const PHONE = { width: 390, height: 844 };

// A container that scrolls its own content sideways keeps the document honest
// while still costing the reader a swipe, so surfaces that should reflow are
// measured one by one. The third field names them, and each is asserted to be
// present: a fixture that stopped producing matches fails here instead of
// quietly skipping the assertion it exists for.
const ROUTES = [
  ["player overview", `/player-overview?puuid=${PUUID}`, []],
  [
    "match history",
    `/match-history?puuid=${PUUID}`,
    ["match-list", "match-history-queue-filters"],
  ],
  [
    "matchmaking analysis",
    `/matchmaking-analysis?puuid=${PUUID}`,
    ["matchmaking-analysis-history-stacked"],
  ],
] as const;

test.describe("player pages on a phone", () => {
  test.use({ viewport: PHONE });

  for (const [name, route, reflowSurfaces] of ROUTES) {
    test(`${name} never scrolls the page sideways`, async ({ page }) => {
      test.setTimeout(60_000);
      await installPopulatedPlayerMocks(page);

      await page.goto(route);
      await page.getByRole("button", { name: "Accept necessary" }).click();

      // Without this the measurement can land on the loading skeletons, which
      // are narrow by construction and would pass whatever the real content
      // does.
      await expect(page.locator("main")).not.toContainText("Loading");
      await page.waitForLoadState("networkidle");

      const { scrollWidth, clientWidth, widest, surfaceOverflow } =
        await page.evaluate((testIds: readonly string[]) => {
          const root = document.documentElement;
          let widest = "";
          let widestRight = root.clientWidth;
          for (const element of document.querySelectorAll("main *")) {
            const right = element.getBoundingClientRect().right;
            if (right > widestRight) {
              widestRight = right;
              widest = `${element.tagName.toLowerCase()}.${element.className} → ${Math.round(right)}px`;
            }
          }
          const surfaceOverflow: Record<string, number | null> = {};
          for (const testId of testIds) {
            const surface = document.querySelector(
              `[data-testid='${testId}']`,
            );
            surfaceOverflow[testId] = surface
              ? surface.scrollWidth - surface.clientWidth
              : null;
          }
          return {
            scrollWidth: root.scrollWidth,
            clientWidth: root.clientWidth,
            widest,
            surfaceOverflow,
          };
        }, reflowSurfaces);

      expect(scrollWidth, `widest overflowing element: ${widest}`).toBe(
        clientWidth,
      );
      for (const testId of reflowSurfaces) {
        expect(
          surfaceOverflow[testId],
          `${testId} should be on this page for its reflow to be measured`,
        ).not.toBeNull();
        expect(
          surfaceOverflow[testId],
          `${testId} should reflow on a phone, not scroll sideways`,
        ).toBeLessThanOrEqual(1);
      }
    });
  }
});
