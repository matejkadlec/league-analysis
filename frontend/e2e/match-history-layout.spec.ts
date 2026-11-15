import { expect, test, type Page } from "@playwright/test";

import {
  gotoPopulatedRoute,
  POPULATED_ROUTES,
} from "./support/populated-player-harness";

/**
 * The Match History row at the three widths it has a layout for (LGA-108).
 * Measured on rendered boxes: the regression was arithmetic between class
 * names in three files, which no assertion on a single class can see.
 */

const MATCH_HISTORY = POPULATED_ROUTES.find(
  (route) => route.name === "match history",
)!;

async function measureRows(page: Page) {
  return page.evaluate(() => {
    const box = (element: Element | null | undefined) => {
      const rect = element?.getBoundingClientRect();
      return rect
        ? { left: rect.left, right: rect.right, top: rect.top }
        : null;
    };
    const list = document.querySelector("[data-testid='match-list']")!;
    const card = document.querySelector("#match-history")!;
    const rows = [
      ...document.querySelectorAll("[data-testid='match-row-layout']"),
    ];
    return {
      listOverflow: list.scrollWidth - list.clientWidth,
      listIsFocusStop: list.hasAttribute("tabindex"),
      documentOverflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
      card: box(card)!,
      rows: rows.map((row) => ({
        objectives: [...row.querySelectorAll("[data-objective]")].map(
          (cell) => box(cell)!,
        ),
        playerStats: box(
          row.querySelector("[data-testid='match-side-stats-player']"),
        )!,
        playerColumn: box(
          row.querySelector("[data-testid='match-side-column-player']"),
        )!,
        opponentColumn: box(
          row.querySelector("[data-testid='match-side-column-opponent']"),
        )!,
        opponentStats: box(
          row.querySelector("[data-testid='match-side-stats-opponent']"),
        )!,
      })),
    };
  });
}

type RowMeasurements = Awaited<ReturnType<typeof measureRows>>;

function expectObjectivesInsideCard({ card, rows }: RowMeasurements) {
  for (const row of rows) {
    // Six objectives for each of the two teams, every one inside the card.
    expect(row.objectives).toHaveLength(12);
    for (const cell of row.objectives) {
      expect(cell.left).toBeGreaterThanOrEqual(card.left);
      expect(cell.right).toBeLessThanOrEqual(card.right);
    }
  }
}

test("a 1920x1080 desktop holds every row on one line with nothing cut off", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await gotoPopulatedRoute(page, MATCH_HISTORY);

  const measured = await measureRows(page);

  expect(measured.rows.length).toBeGreaterThan(0);
  expect(measured.listOverflow).toBe(0);
  expect(measured.documentOverflow).toBe(0);
  // Nothing scrolls sideways, so there is no region to reach by keyboard.
  expect(measured.listIsFocusStop).toBe(false);
  expectObjectivesInsideCard(measured);
  for (const row of measured.rows) {
    // One line: the last objective starts no lower than the stat block ends.
    const objectiveTops = row.objectives.map((cell) => cell.top);
    expect(Math.min(...objectiveTops)).toBeLessThan(row.playerStats.top + 40);
    // No dead zone: the opponent's stats sit as close to their champion
    // column as the player's stats sit to theirs.
    const playerGap = row.playerColumn.left - row.playerStats.right;
    const opponentGap = row.opponentStats.left - row.opponentColumn.right;
    expect(playerGap).toBeGreaterThanOrEqual(0);
    expect(Math.abs(opponentGap - playerGap)).toBeLessThanOrEqual(2);
  }
});

test("a 1366x768 laptop wraps teams and objectives onto a second line", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await gotoPopulatedRoute(page, MATCH_HISTORY);

  const measured = await measureRows(page);

  expect(measured.rows.length).toBeGreaterThan(0);
  expect(measured.listOverflow).toBe(0);
  expect(measured.documentOverflow).toBe(0);
  expectObjectivesInsideCard(measured);
  for (const row of measured.rows) {
    // The matchup keeps its desktop line: stats, champions, stats, in order.
    expect(row.playerStats.right).toBeLessThanOrEqual(row.playerColumn.left);
    expect(row.opponentColumn.right).toBeLessThanOrEqual(
      row.opponentStats.left,
    );
    expect(Math.abs(row.playerStats.top - row.opponentStats.top)).toBeLessThan(
      1,
    );
    // And the objectives sit on a line of their own beneath it.
    for (const cell of row.objectives) {
      expect(cell.top).toBeGreaterThan(row.playerStats.top + 40);
    }
  }
});

test("a 390px phone still stacks the row instead of scrolling it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoPopulatedRoute(page, MATCH_HISTORY);

  const measured = await measureRows(page);

  expect(measured.rows.length).toBeGreaterThan(0);
  expect(measured.listOverflow).toBeLessThanOrEqual(1);
  expect(measured.documentOverflow).toBe(0);
  expectObjectivesInsideCard(measured);
  for (const row of measured.rows) {
    // Stacked: the matchup leads, and the two stat blocks share the line
    // beneath it, the player's on the left.
    expect(row.playerColumn.top).toBeLessThan(row.playerStats.top);
    expect(row.playerStats.right).toBeLessThanOrEqual(row.opponentStats.left);
    expect(Math.abs(row.playerStats.top - row.opponentStats.top)).toBeLessThan(
      1,
    );
  }
});
