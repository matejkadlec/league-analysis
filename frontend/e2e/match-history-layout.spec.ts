import { expect, test, type Page } from "@playwright/test";

import {
  gotoPopulatedRoute,
  POPULATED_ROUTES,
} from "./support/populated-player-harness";

/**
 * The Match History row at every width it has a layout for (LGA-108).
 * Measured on rendered boxes: the regression was arithmetic between class
 * names in three files, which no assertion on a single class can see.
 */

const MATCH_HISTORY = POPULATED_ROUTES.find(
  (route) => route.name === "match history",
)!;

async function measureRows(page: Page) {
  // Widths below depend on the web font, which swaps in after first paint.
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(() => {
    const box = (element: Element | null | undefined) => {
      const rect = element?.getBoundingClientRect();
      return rect
        ? {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
          }
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
        // A zero box below `lg`, where the group is `display: contents`.
        info: box(row.querySelector("[data-testid='match-row-info']"))!,
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

type Measurements = Awaited<ReturnType<typeof measureRows>>;
type Row = Measurements["rows"][number];

/** The list does not scroll sideways and every objective is inside the card. */
function expectNothingCutOff({ card, rows, listOverflow }: Measurements) {
  expect(rows.length).toBeGreaterThan(0);
  // One pixel of tolerance for sub-pixel rounding, as the phone specs allow.
  expect(listOverflow).toBeLessThanOrEqual(1);
  for (const row of rows) {
    expect(row.objectives).toHaveLength(12);
    for (const cell of row.objectives) {
      expect(cell.left).toBeGreaterThanOrEqual(card.left);
      expect(cell.right).toBeLessThanOrEqual(card.right);
    }
  }
}

/** Stats, champion, champion, stats on one line, mirrored around the swords. */
function expectMatchupOnOneLine(row: Row) {
  expect(Math.abs(row.playerStats.top - row.opponentStats.top)).toBeLessThan(1);
  // No dead zone: the opponent's stats sit as close to their champion column
  // as the player's stats sit to theirs.
  const playerGap = row.playerColumn.left - row.playerStats.right;
  const opponentGap = row.opponentStats.left - row.opponentColumn.right;
  expect(playerGap).toBeGreaterThanOrEqual(0);
  expect(Math.abs(opponentGap - playerGap)).toBeLessThanOrEqual(2);
}

const highestObjective = (row: Row) =>
  Math.min(...row.objectives.map((cell) => cell.top));
const lowestObjective = (row: Row) =>
  Math.max(...row.objectives.map((cell) => cell.top));

test("a 1920x1080 desktop holds every row on one line with nothing cut off", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await gotoPopulatedRoute(page, MATCH_HISTORY);

  const measured = await measureRows(page);

  expectNothingCutOff(measured);
  expect(measured.listOverflow).toBe(0);
  expect(measured.documentOverflow).toBe(0);
  // Nothing scrolls sideways, so there is no region to reach by keyboard.
  expect(measured.listIsFocusStop).toBe(false);
  for (const row of measured.rows) {
    expectMatchupOnOneLine(row);
    // One line: every objective starts before the stat block has ended.
    expect(lowestObjective(row)).toBeLessThan(row.playerStats.bottom);
  }
});

for (const { viewport, lines } of [
  { viewport: { width: 1366, height: 768 }, lines: 2 },
  { viewport: { width: 1280, height: 720 }, lines: 3 },
  { viewport: { width: 1024, height: 768 }, lines: 3 },
]) {
  test(`a ${viewport.width}px laptop wraps the row onto ${lines} lines around an intact matchup`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await gotoPopulatedRoute(page, MATCH_HISTORY);

    const measured = await measureRows(page);

    expectNothingCutOff(measured);
    expect(measured.documentOverflow).toBe(0);
    for (const row of measured.rows) {
      expectMatchupOnOneLine(row);
      expect(highestObjective(row)).toBeGreaterThanOrEqual(
        row.playerStats.bottom,
      );
      // Two lines keep match info beside the matchup; three put it above.
      if (lines === 2) {
        expect(row.info.top).toBeLessThan(row.playerStats.bottom);
        expect(row.info.bottom).toBeGreaterThan(row.playerStats.top);
      } else {
        expect(row.info.bottom).toBeLessThanOrEqual(row.playerStats.top);
      }
    }
  });
}

for (const { width, pageFits } of [
  { width: 390, pageFits: true },
  { width: 360, pageFits: true },
  // LGA-137: the card header's totals line is 12px too wide at 320px. The
  // rows are measured here regardless; the page itself joins once that lands.
  { width: 320, pageFits: false },
]) {
  test(`a ${width}px phone stacks the row instead of scrolling it`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await gotoPopulatedRoute(page, MATCH_HISTORY);

    const measured = await measureRows(page);

    expectNothingCutOff(measured);
    if (pageFits) {
      expect(measured.documentOverflow).toBe(0);
    } else {
      // Asserted, not skipped, so this fails once LGA-137 lands.
      expect(measured.documentOverflow).toBeGreaterThan(0);
    }
    for (const row of measured.rows) {
      // Stacked: the matchup leads, and the two stat blocks share the line
      // beneath it, the player's on the left.
      expect(row.playerColumn.top).toBeLessThan(row.playerStats.top);
      expect(row.playerStats.right).toBeLessThanOrEqual(row.opponentStats.left);
      expect(
        Math.abs(row.playerStats.top - row.opponentStats.top),
      ).toBeLessThan(1);
    }
  });
}
