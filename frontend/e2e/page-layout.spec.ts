import { expect, test, type Page } from "@playwright/test";

import { ADMIN_ROUTES, gotoAdminRoute } from "./support/admin-pages-harness";
import { acceptCookieBanner } from "./support/auth";
import {
  gotoPopulatedRoute,
  POPULATED_ROUTES,
} from "./support/populated-player-harness";
import { installSmurfBoostMocks, PUUID } from "./support/smurf-boost-harness";

/**
 * The one layout rule of every card page (LGA-152), measured on each page in
 * scope with its cards populated: cards side by side end on one line, and no
 * card ends in an empty band because a neighbour is taller.
 */

interface PageCase {
  name: string;
  open: (page: Page) => Promise<void>;
}

const PAGES: PageCase[] = [
  ...POPULATED_ROUTES.map((route) => ({
    name: route.name,
    open: (page: Page) => gotoPopulatedRoute(page, route),
  })),
  ...ADMIN_ROUTES.map((route) => ({
    name: route.name,
    open: (page: Page) => gotoAdminRoute(page, route),
  })),
  {
    name: "rank manipulation",
    open: async (page: Page) => {
      await installSmurfBoostMocks(page);
      await page.goto(`/rank-manipulation?puuid=${PUUID}`);
      await acceptCookieBanner(page);
      await page.getByRole("button", { name: "Run the comparison" }).click();
      await expect(page.locator("#smurf-boost-result")).toBeVisible();
    },
  },
];

// A card's own bottom padding is 24px. Past that, a band of this much empty
// space reads as a hole left by a taller neighbour rather than as padding.
const EMPTY_BAND_LIMIT = 48;
const EDGE_TOLERANCE = 1;

interface CardBox {
  label: string;
  top: number;
  bottom: number;
  left: number;
  right: number;
  emptyBand: number;
}

/**
 * Every top-level card in `main`, with the band between its lowest content
 * and its bottom edge. Content is text, controls and graphics: a container
 * stretched to fill the card says nothing about what is inside it.
 */
function measureCards(page: Page): Promise<CardBox[]> {
  return page.evaluate(() => {
    const CARD = ".rounded-xl.border.bg-card";
    const LEAF = "svg, img, canvas, input, button, select, textarea";
    const visible = (rect: DOMRect) => rect.width > 0 && rect.height > 0;

    const lowestContent = (card: Element): number => {
      let lowest = card.getBoundingClientRect().top;
      for (const leaf of card.querySelectorAll(LEAF)) {
        const rect = leaf.getBoundingClientRect();
        if (visible(rect)) lowest = Math.max(lowest, rect.bottom);
      }
      const texts = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
      for (let node = texts.nextNode(); node; node = texts.nextNode()) {
        if (!node.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();
        if (visible(rect)) lowest = Math.max(lowest, rect.bottom);
      }
      return lowest;
    };

    return [...document.querySelectorAll(`main ${CARD}`)]
      .filter((card) => !card.parentElement?.closest(CARD))
      .map((card) => ({ card, rect: card.getBoundingClientRect() }))
      .filter(({ rect }) => visible(rect))
      .map(({ card, rect }) => ({
        label:
          card.id ||
          card.querySelector("h1, h2, h3")?.textContent?.trim() ||
          card.textContent?.trim().slice(0, 40) ||
          "card",
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        emptyBand: Math.round(rect.bottom - lowestContent(card)),
      }));
  });
}

function sideBySide(a: CardBox, b: CardBox): boolean {
  const apart = a.right <= b.left + 1 || b.right <= a.left + 1;
  const overlapping = Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
  return apart && overlapping;
}

function pairsOf(cards: CardBox[]): [CardBox, CardBox][] {
  return cards.flatMap((a, index) =>
    cards
      .slice(index + 1)
      .filter((b) => sideBySide(a, b))
      .map((b) => [a, b] as [CardBox, CardBox]),
  );
}

for (const pageCase of PAGES) {
  test.describe(pageCase.name, () => {
    for (const viewport of [
      { width: 1920, height: 1080 },
      { width: 1366, height: 768 },
    ]) {
      test(`cards side by side end together at ${viewport.width}px`, async ({
        page,
      }) => {
        await page.setViewportSize(viewport);
        await pageCase.open(page);

        const cards = await measureCards(page);
        const pairs = pairsOf(cards);
        for (const [a, b] of pairs) {
          const names = `${a.label} | ${b.label}`;
          expect(
            Math.abs(a.top - b.top),
            `tops of ${names}`,
          ).toBeLessThanOrEqual(EDGE_TOLERANCE);
          expect(
            Math.abs(a.bottom - b.bottom),
            `bottoms of ${names}`,
          ).toBeLessThanOrEqual(EDGE_TOLERANCE);
        }
        // Equal edges are what stretching gives for free; the content has to
        // reach the edge too, or the hole has only moved inside the card.
        for (const card of new Set(pairs.flat())) {
          expect(
            card.emptyBand,
            `empty band at the bottom of ${card.label}`,
          ).toBeLessThanOrEqual(EMPTY_BAND_LIMIT);
        }
      });
    }

    for (const width of [1920, 1366, 1024, 390, 320]) {
      test(`never scrolls sideways at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await pageCase.open(page);
        const { scrollWidth, clientWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(scrollWidth).toBe(clientWidth);
      });
    }

    test("stacks every card in reading order on a phone", async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await pageCase.open(page);
      const cards = await measureCards(page);
      expect(pairsOf(cards), "cards side by side on a phone").toEqual([]);
      const tops = cards.map((card) => card.top);
      expect(tops).toEqual([...tops].sort((a, b) => a - b));
    });
  });
}

test("Top Champions lists ten champions, not as many as its neighbour has roles", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await gotoPopulatedRoute(page, POPULATED_ROUTES[0]);
  await expect(
    page.getByRole("list", { name: "Top champions" }).getByRole("listitem"),
  ).toHaveCount(10);
});
