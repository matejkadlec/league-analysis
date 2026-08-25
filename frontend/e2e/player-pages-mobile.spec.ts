import { expect, test } from "@playwright/test";

import {
  gotoPopulatedRoute,
  POPULATED_ROUTES,
} from "./support/populated-player-harness";

/**
 * `main` in the app shell is a flex item, so content wider than the viewport
 * stretches the document rather than its own card -- hence the assertion on
 * the document. Against an empty database every route reports exactly 390.
 */

const PHONE = { width: 390, height: 844 };

// A container that scrolls its own content keeps the document honest while
// still costing the reader a swipe, so surfaces that should reflow are measured
// one by one and each asserted present.
test.describe("player pages on a phone", () => {
  test.use({ viewport: PHONE });

  for (const route of POPULATED_ROUTES) {
    const { name, reflowSurfaces } = route;
    test(`${name} never scrolls the page sideways`, async ({ page }) => {
      test.setTimeout(60_000);
      // The readiness gate inside waits for populated content, so the
      // measurement cannot land on the loading skeletons, which are narrow
      // by construction and would pass whatever the real content does.
      await gotoPopulatedRoute(page, route);

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
