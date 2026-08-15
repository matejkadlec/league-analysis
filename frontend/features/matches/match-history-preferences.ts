import { canUseOptionalStorage } from "@/features/cookie-consent";

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

export const MATCH_HISTORY_PAGE_SIZE_STORAGE_KEY =
  "league_analysis_match_history_page_size";
export const MATCH_HISTORY_QUEUE_FILTERS_STORAGE_KEY =
  "league_analysis_match_history_queue_filters";

export interface MatchHistoryPreferences {
  pageSize: MatchHistoryPageSize;
  queueFilters: MatchHistoryQueueSelection;
}

function defaultPreferences(): MatchHistoryPreferences {
  return {
    pageSize: DEFAULT_MATCH_HISTORY_PAGE_SIZE,
    queueFilters: [...DEFAULT_MATCH_HISTORY_QUEUE_SELECTION],
  };
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
  if (typeof window === "undefined" || !canUseOptionalStorage()) {
    return defaultPreferences();
  }

  try {
    return {
      pageSize: parseStoredMatchHistoryPageSize(
        window.localStorage.getItem(MATCH_HISTORY_PAGE_SIZE_STORAGE_KEY),
      ),
      queueFilters: parseStoredMatchHistoryQueueFilters(
        window.localStorage.getItem(MATCH_HISTORY_QUEUE_FILTERS_STORAGE_KEY),
      ),
    };
  } catch {
    return defaultPreferences();
  }
}

export function persistMatchHistoryPageSize(
  pageSize: MatchHistoryPageSize,
): void {
  if (typeof window === "undefined" || !canUseOptionalStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(
      MATCH_HISTORY_PAGE_SIZE_STORAGE_KEY,
      String(pageSize),
    );
  } catch {
    // Keep the in-memory selection when browser storage is unavailable.
  }
}

export function persistMatchHistoryQueueFilters(
  queueFilters: ReadonlyArray<MatchHistoryQueueFilter>,
): void {
  if (typeof window === "undefined" || !canUseOptionalStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(
      MATCH_HISTORY_QUEUE_FILTERS_STORAGE_KEY,
      JSON.stringify(queueFilters),
    );
  } catch {
    // Keep the in-memory selection when browser storage is unavailable.
  }
}
