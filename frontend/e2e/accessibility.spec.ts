import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { acceptCookieBanner } from "./support/auth";
import { blockUpstreamRequests } from "./support/offline";
import {
  gotoPopulatedRoute,
  POPULATED_ROUTES,
} from "./support/populated-player-harness";

/** One line per offending element, so a failure names them all at once. */
const readableViolations = (
  violations: readonly {
    id: string;
    help: string;
    nodes: readonly { html: string }[];
  }[],
): string[] =>
  violations.flatMap((violation) =>
    violation.nodes.map(
      (node) => `${violation.id}: ${violation.help} \u2192 ${node.html}`,
    ),
  );

/**
 * axe over the data-rich player pages: against an empty database the rows and
 * tables never mount and the scan proves nothing. axe does NOT catch
 * use-of-color -- the win/loss tint is a known open finding.
 */

test.describe("axe scan of the populated player pages", () => {
  for (const route of POPULATED_ROUTES) {
    test(`${route.name} has no WCAG A/AA violations`, async ({ page }) => {
      await gotoPopulatedRoute(page, route);

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();

      expect(readableViolations(results.violations)).toEqual([]);
    });
  }
});

/**
 * The populated scans above all run behind a session. `/sign-in` is the front
 * door and the only route with a real form -- labels, validation messaging and
 * a third-party widget -- so it is the page where a violation costs the most.
 */
test("the sign-in page has no WCAG A/AA violations", async ({ page }) => {
  await blockUpstreamRequests(page);
  await page.goto("/sign-in");
  // The consent dialog is modal, so everything behind it leaves the
  // accessibility tree and a scan would grade the dialog alone.
  await acceptCookieBanner(page);
  await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  expect(readableViolations(results.violations)).toEqual([]);
});
