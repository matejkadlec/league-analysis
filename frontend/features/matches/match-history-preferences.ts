import { z } from "zod";

import { parseUntrustedJson } from "@/lib/core/http/untrusted-json";

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
} from "@/lib/core/riot/queue-catalog";

const STORED_QUEUE_FILTERS_SCHEMA = z.array(z.unknown());

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
  // Element-wise `unknown`: an id this build no longer offers is dropped
  // below rather than discarding the rest of a viewer's selection with it.
  const parsedValue = parseUntrustedJson(
    STORED_QUEUE_FILTERS_SCHEMA,
    storedValue,
  );
  if (parsedValue === null) {
    return [...DEFAULT_MATCH_HISTORY_QUEUE_SELECTION];
  }

  // `unknown`, so membership in the catalog is the whole check: a stored id
  // is whatever the last build wrote, or whatever a viewer typed in.
  const validFilters: ReadonlySet<unknown> = new Set(
    MATCH_HISTORY_QUEUE_FILTERS.map(({ id }) => id),
  );
  const requestedFilters = new Set(
    parsedValue.filter((value): value is MatchHistoryQueueFilter =>
      validFilters.has(value),
    ),
  );
  if (requestedFilters.has("ALL")) {
    return ["ALL"];
  }

  const orderedFilters = MATCH_HISTORY_QUEUE_FILTERS.map(({ id }) => id).filter(
    (filter): filter is MatchHistoryQueueFilter => requestedFilters.has(filter),
  );
  return orderedFilters.length > 0
    ? orderedFilters
    : [...DEFAULT_MATCH_HISTORY_QUEUE_SELECTION];
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
