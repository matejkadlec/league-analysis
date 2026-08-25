import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import {
  gotoPopulatedRoute,
  POPULATED_ROUTES,
} from "./support/populated-player-harness";

/**
 * axe over the data-rich player pages: against an empty database the rows and
 * tables never mount and the scan proves nothing. axe does NOT catch
 * use-of-color -- the win/loss tint is a known open finding.
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
