import { describe, expect, it } from "vitest";

import {
  getChampionPage,
  pageForChampionDataSource,
} from "../features/profile/champion-pagination";

describe("Top Champions pagination", () => {
  it("uses a fixed ten-row page size across first, middle, and partial-final pages", () => {
    const champions = Array.from({ length: 23 }, (_, index) => index + 1);

    expect(getChampionPage(champions, 0)).toMatchObject({
      items: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      page: 0,
      startIndex: 0,
      endIndex: 10,
      totalPages: 3,
    });
    expect(getChampionPage(champions, 1)).toMatchObject({
      items: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
      page: 1,
      startIndex: 10,
      endIndex: 20,
      totalPages: 3,
    });
    expect(getChampionPage(champions, 2)).toMatchObject({
      items: [21, 22, 23],
      page: 2,
      startIndex: 20,
      endIndex: 23,
      totalPages: 3,
    });
  });

  it("clamps page boundaries and resets when the viewed data source changes", () => {
    const champions = Array.from({ length: 13 }, (_, index) => index);

    expect(getChampionPage(champions, -1).page).toBe(0);
    expect(getChampionPage(champions, 9).page).toBe(1);
    expect(
      pageForChampionDataSource(
        { dataSourceKey: "player-a:queue:420", page: 1 },
        "player-a:queue:420",
      ),
    ).toBe(1);
    expect(
      pageForChampionDataSource(
        { dataSourceKey: "player-a:queue:420", page: 1 },
        "player-b:queue:420",
      ),
    ).toBe(0);
  });

  it("keeps one-or-fewer-page datasets on the first page", () => {
    expect(getChampionPage([], 3)).toMatchObject({
      items: [],
      page: 0,
      startIndex: 0,
      endIndex: 0,
      totalPages: 0,
    });
    expect(
      getChampionPage(
        Array.from({ length: 10 }, (_, index) => index),
        1,
      ).page,
    ).toBe(0);
  });
});
