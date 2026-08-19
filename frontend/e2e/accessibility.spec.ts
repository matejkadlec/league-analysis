import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import {
  gotoPopulatedRoute,
  POPULATED_ROUTES,
} from "./support/populated-player-harness";

/**
 * axe-core over the data-rich player pages. The fixtures matter here for the
 * same reason they matter to the reflow specs: against an empty database the
 * match rows, stat tables and history cards never mount, and a scan of an
 * empty page proves nothing about the surfaces people actually read. The
 * readiness gate lives in `gotoPopulatedRoute`, which waits for populated
 * content — the skeletons are textless, so no wait on "Loading" can work.
 *
 * What axe can and cannot see: it catches missing labels, roles, names,
 * contrast and structural misuse automatically. It does NOT catch
 * use-of-color (WCAG 1.4.1) — the match rows conveying win/loss by tint
 * alone are a known open finding that no automated rule flags. It also only
 * grades what the fixtures put on screen: a fallback branch the fixtures
 * never render is invisible to this gate.
 */

test.describe("axe scan of the populated player pages", () => {
  for (const route of POPULATED_ROUTES) {
    test(`${route.name} has no WCAG A/AA violations`, async ({ page }) => {
      test.setTimeout(60_000);
      await gotoPopulatedRoute(page, route);

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();

      // One line per offending element, so a failure names them all instead
      // of demanding a local re-run per fix.
      const readable = results.violations.flatMap((violation) =>
        violation.nodes.map(
          (node) => `${violation.id}: ${violation.help} → ${node.html}`,
        ),
      );
      expect(readable).toEqual([]);
    });
  }
});
