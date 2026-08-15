import { describe, expect, it } from "vitest";

import {
  DEFAULT_MATCH_HISTORY_PAGE_SIZE,
  getMatchHistoryPaginationItems,
  getMatchHistoryRecordRange,
  MATCH_HISTORY_PAGE_SIZES,
} from "@/features/matches/match-history-pagination";

describe("Match History pagination", () => {
  it("uses the approved page sizes and default", () => {
    expect(MATCH_HISTORY_PAGE_SIZES).toEqual([25, 50, 100, 250, 500, 1000]);
    expect(DEFAULT_MATCH_HISTORY_PAGE_SIZE).toBe(25);
  });

  it("shows all pages when five or fewer exist", () => {
    expect(getMatchHistoryPaginationItems(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("keeps the first, last, and current neighborhood with ellipses", () => {
    expect(getMatchHistoryPaginationItems(1, 10)).toEqual([
      1,
      2,
      3,
      4,
      "ellipsis-right",
      10,
    ]);
    expect(getMatchHistoryPaginationItems(5, 10)).toEqual([
      1,
      "ellipsis-left",
      4,
      5,
      6,
      "ellipsis-right",
      10,
    ]);
    expect(getMatchHistoryPaginationItems(10, 10)).toEqual([
      1,
      "ellipsis-left",
      7,
      8,
      9,
      10,
    ]);
  });

  it("reports real record ranges, including an empty result", () => {
    expect(getMatchHistoryRecordRange(2, 25, 63)).toEqual({
      start: 26,
      end: 50,
    });
    expect(getMatchHistoryRecordRange(3, 25, 63)).toEqual({
      start: 51,
      end: 63,
    });
    expect(getMatchHistoryRecordRange(1, 50, 0)).toEqual({
      start: 0,
      end: 0,
    });
  });
});
