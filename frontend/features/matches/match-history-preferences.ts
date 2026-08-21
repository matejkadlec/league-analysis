import {
  MATCH_HISTORY_PAGE_SIZE_STORAGE_KEY,
  MATCH_HISTORY_QUEUE_FILTERS_STORAGE_KEY,
  readOptionalStorage,
  writeOptionalStorage,
} from "@/features/cookie-consent";

import {
  DEFAULT_MATCH_HISTORY_PAGE_SIZE,
  MATCH_HISTORY_PAGE_SIZES,
  type MatchHistoryPageSize,
} from "./match-history-pagination";
import {
  DEFAULT_MATCH_HISTORY_QUEUE_SELECTION,
  MATCH_HISTORY_QUEUE_FILTERS,
  type MatchHistoryQueueFilter,
  type MatchHistoryQueueSelection,
} from "./queue-catalog";

export interface MatchHistoryPreferences {
  pageSize: MatchHistoryPageSize;
  queueFilters: MatchHistoryQueueSelection;
}

export function parseStoredMatchHistoryPageSize(
  storedValue: string | null,
): MatchHistoryPageSize {
  const parsedValue = Number(storedValue);
  return MATCH_HISTORY_PAGE_SIZES.find((size) => size === parsedValue) ??
    DEFAULT_MATCH_HISTORY_PAGE_SIZE;
}

export function parseStoredMatchHistoryQueueFilters(
  storedValue: string | null,
): MatchHistoryQueueSelection {
  if (!storedValue) {
    return [...DEFAULT_MATCH_HISTORY_QUEUE_SELECTION];
  }

  try {
    const parsedValue: unknown = JSON.parse(storedValue);
    if (!Array.isArray(parsedValue)) {
      return [...DEFAULT_MATCH_HISTORY_QUEUE_SELECTION];
    }

    const validFilters = new Set<MatchHistoryQueueFilter>(
      MATCH_HISTORY_QUEUE_FILTERS.map(({ id }) => id),
    );
    const requestedFilters = new Set(
      parsedValue.filter(
        (value): value is MatchHistoryQueueFilter =>
          (typeof value === "number" || value === "ALL") &&
          validFilters.has(value),
      ),
    );
    if (requestedFilters.has("ALL")) {
      return ["ALL"];
    }

    const orderedFilters = MATCH_HISTORY_QUEUE_FILTERS.map(({ id }) =>
      id,
    ).filter(
      (filter): filter is MatchHistoryQueueFilter =>
        requestedFilters.has(filter),
    );
    return orderedFilters.length > 0
      ? orderedFilters
      : [...DEFAULT_MATCH_HISTORY_QUEUE_SELECTION];
  } catch {
    return [...DEFAULT_MATCH_HISTORY_QUEUE_SELECTION];
  }
}

export function readMatchHistoryPreferences(): MatchHistoryPreferences {
  // Both parsers answer a missing value with the default, so an unreadable
  // store needs no separate branch.
  return {
    pageSize: parseStoredMatchHistoryPageSize(
      readOptionalStorage(MATCH_HISTORY_PAGE_SIZE_STORAGE_KEY),
    ),
    queueFilters: parseStoredMatchHistoryQueueFilters(
      readOptionalStorage(MATCH_HISTORY_QUEUE_FILTERS_STORAGE_KEY),
    ),
  };
}

export function persistMatchHistoryPageSize(
  pageSize: MatchHistoryPageSize,
): void {
  writeOptionalStorage(MATCH_HISTORY_PAGE_SIZE_STORAGE_KEY, String(pageSize));
}

export function persistMatchHistoryQueueFilters(
  queueFilters: ReadonlyArray<MatchHistoryQueueFilter>,
): void {
  writeOptionalStorage(
    MATCH_HISTORY_QUEUE_FILTERS_STORAGE_KEY,
    JSON.stringify(queueFilters),
  );
}
