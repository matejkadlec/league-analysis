import { expect, test } from "@playwright/test";

import {
  gotoPopulatedRoute,
  POPULATED_ROUTES,
} from "./support/populated-player-harness";

/**
 * `main` is a flex item, so content wider than the viewport stretches the
 * document rather than its own card -- hence the assertion on the document.
 */

const PHONE = { width: 390, height: 844 };

// A container that scrolls its own content keeps the document honest but still
// costs a swipe, so each reflow surface is measured separately.
test.describe("player pages on a phone", () => {
  // A viewport alone leaves a desktop user agent and a mouse, so a hover-only
  // affordance (`track-player-button` swaps its label on group-hover) would go uncaught.
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  for (const route of POPULATED_ROUTES) {
    const { name, reflowSurfaces } = route;
    test(`${name} never scrolls the page sideways`, async ({ page }) => {
      // The readiness gate waits for populated content: loading skeletons are
      // narrow by construction and would pass whatever the real content does.
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
