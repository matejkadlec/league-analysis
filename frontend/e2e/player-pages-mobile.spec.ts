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

// The third field says whether the route renders the match list, so a fixture
// that stopped producing matches fails here instead of quietly skipping the
// assertion that list exists for.
const ROUTES = [
  ["player overview", `/player-overview?puuid=${PUUID}`, false],
  ["match history", `/match-history?puuid=${PUUID}`, true],
  ["matchmaking analysis", `/matchmaking-analysis?puuid=${PUUID}`, false],
] as const;

test.describe("player pages on a phone", () => {
  test.use({ viewport: PHONE });

  for (const [name, route, hasMatchList] of ROUTES) {
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

      const { scrollWidth, clientWidth, widest, matchListOverflow } =
        await page.evaluate(() => {
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
          // A container that scrolls its own content sideways keeps the
          // document honest while still costing a swipe per row, so the match
          // list reflowing rather than scrolling is its own assertion.
          const list = document.querySelector("[data-testid='match-list']");
          return {
            scrollWidth: root.scrollWidth,
            clientWidth: root.clientWidth,
            widest,
            matchListOverflow: list
              ? list.scrollWidth - list.clientWidth
              : null,
          };
        });

      expect(scrollWidth, `widest overflowing element: ${widest}`).toBe(
        clientWidth,
      );
      if (hasMatchList) {
        expect(
          matchListOverflow,
          "the match list should be on this page for the reflow to be measured",
        ).not.toBeNull();
        expect(
          matchListOverflow,
          "match rows should reflow on a phone, not scroll sideways",
        ).toBeLessThanOrEqual(1);
      }
    });
  }
});
