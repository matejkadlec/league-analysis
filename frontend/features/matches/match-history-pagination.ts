export const MATCH_HISTORY_PAGE_SIZES = [25, 50, 100, 250, 500, 1000] as const;
export const DEFAULT_MATCH_HISTORY_PAGE_SIZE = 25;

export type MatchHistoryPageSize = (typeof MATCH_HISTORY_PAGE_SIZES)[number];

export type MatchHistoryPaginationItem =
  | number
  | "ellipsis-left"
  | "ellipsis-right";

export interface MatchHistoryRecordRange {
  start: number;
  end: number;
}

export function getMatchHistoryRecordRange(
  page: number,
  pageSize: number,
  total: number,
): MatchHistoryRecordRange {
  if (total === 0) {
    return { start: 0, end: 0 };
  }

  const start = (page - 1) * pageSize + 1;
  return { start, end: Math.min(start + pageSize - 1, total) };
}

export function getMatchHistoryPaginationItems(
  page: number,
  totalPages: number,
): MatchHistoryPaginationItem[] {
  if (totalPages <= 0) {
    return [];
  }

  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  if (page <= 3) {
    return [1, 2, 3, 4, "ellipsis-right", totalPages];
  }

  if (page >= totalPages - 2) {
    return [
      1,
      "ellipsis-left",
      totalPages - 3,
      totalPages - 2,
      totalPages - 1,
      totalPages,
    ];
  }

  return [
    1,
    "ellipsis-left",
    page - 1,
    page,
    page + 1,
    "ellipsis-right",
    totalPages,
  ];
}
