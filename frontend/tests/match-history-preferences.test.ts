// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { clearOptionalBrowserStorage } from "@/features/cookie-consent";
import {
  MATCH_HISTORY_PAGE_SIZE_STORAGE_KEY,
  MATCH_HISTORY_QUEUE_FILTERS_STORAGE_KEY,
  parseStoredMatchHistoryPageSize,
  parseStoredMatchHistoryQueueFilters,
  persistMatchHistoryPageSize,
  persistMatchHistoryQueueFilters,
  readMatchHistoryPreferences,
} from "@/features/matches/match-history-preferences";
import { installMemoryLocalStorage } from "./test-browser-storage";

const CONSENT_COOKIE = "league_analysis_cookie_consent";

installMemoryLocalStorage();

function setOptionalConsent(): void {
  const value = encodeURIComponent(
    `v1|all|${new Date("2026-08-15T00:00:00Z").toISOString()}`,
  );
  document.cookie = `${CONSENT_COOKIE}=${value}; Path=/`;
}

function clearConsent(): void {
  document.cookie = `${CONSENT_COOKIE}=; Path=/; Max-Age=0`;
}

describe("Match History preferences", () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearConsent();
  });

  afterEach(() => {
    window.localStorage.clear();
    clearConsent();
  });

  it("normalizes stored page sizes and queue selections", () => {
    expect(parseStoredMatchHistoryPageSize("500")).toBe(500);
    expect(parseStoredMatchHistoryPageSize("10")).toBe(25);
    expect(parseStoredMatchHistoryQueueFilters('[440,420,440]')).toEqual([
      420, 440,
    ]);
    expect(parseStoredMatchHistoryQueueFilters('["ALL",440]')).toEqual([
      "ALL",
    ]);
    expect(parseStoredMatchHistoryQueueFilters("invalid")).toEqual([420]);
  });

  it("persists only with optional consent and restores on reload", () => {
    persistMatchHistoryPageSize(100);
    persistMatchHistoryQueueFilters([440]);
    expect(window.localStorage.length).toBe(0);

    setOptionalConsent();
    persistMatchHistoryPageSize(100);
    persistMatchHistoryQueueFilters([440]);

    expect(readMatchHistoryPreferences()).toEqual({
      pageSize: 100,
      queueFilters: [440],
    });
  });

  it("clears both optional Match History keys on consent withdrawal", () => {
    setOptionalConsent();
    persistMatchHistoryPageSize(1000);
    persistMatchHistoryQueueFilters([420, 440]);

    clearOptionalBrowserStorage();

    expect(
      window.localStorage.getItem(MATCH_HISTORY_PAGE_SIZE_STORAGE_KEY),
    ).toBeNull();
    expect(
      window.localStorage.getItem(MATCH_HISTORY_QUEUE_FILTERS_STORAGE_KEY),
    ).toBeNull();
  });
});
