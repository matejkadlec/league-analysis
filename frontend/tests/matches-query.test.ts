import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { validatedGet } = vi.hoisted(() => ({
  validatedGet: vi.fn<typeof import("@/lib/core/api").validatedGet>(),
}));

vi.mock("@/lib/core/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/api")>()),
  validatedGet,
}));

import {
  isMatchHistoryQuery,
  matchHistoryDetailedQueryOptions,
  matchHistoryStatsQueryOptions,
} from "@/features/matches/matches-query";

const stats = {
  puuid: "player-puuid",
  total_matches: 12,
  wins: 8,
  losses: 4,
  win_rate: 0.67,
  avg_kills: 5.2,
  avg_deaths: 3.1,
  avg_assists: 7.4,
  avg_kda: 4.06,
  avg_cs: 178.3,
  avg_vision_score: 21.9,
};

const detailed = {
  matches: [],
  total_analyzed: 0,
  total: 0,
  page: 1,
  size: 10,
  pages: 0,
};

describe("the match history caches", () => {
  beforeEach(() => validatedGet.mockReset());

  it("scopes the stats read to the player and the queue filter", async () => {
    validatedGet.mockResolvedValue({ success: true, data: stats });
    const queryClient = new QueryClient();

    await queryClient.fetchQuery(
      matchHistoryStatsQueryOptions("player-puuid", "420"),
    );

    expect(validatedGet.mock.calls[0]?.[1]).toBe(
      "/matches/player/player-puuid/stats",
    );
    expect(validatedGet.mock.calls[0]?.[2]).toEqual({ queues: "420" });
    expect(
      queryClient.getQueryData(["match-history-stats", "player-puuid", "420"]),
    ).toEqual(stats);
    // A filtered view must not satisfy the unfiltered one's cache, or
    // dropping the filter keeps showing the filtered totals.
    expect(
      matchHistoryStatsQueryOptions("player-puuid", "420").queryKey,
    ).not.toEqual(
      matchHistoryStatsQueryOptions("player-puuid", undefined).queryKey,
    );
  });

  it("turns the pager's page into the API's start offset, and drops an empty search", async () => {
    validatedGet.mockResolvedValue({ success: true, data: detailed });
    const queryClient = new QueryClient();

    await queryClient.fetchQuery(
      matchHistoryDetailedQueryOptions({
        puuid: "player-puuid",
        queueQueryParam: "420",
        search: "",
        page: 3,
        pageSize: 10,
      }),
    );

    expect(validatedGet.mock.calls[0]?.[1]).toBe(
      "/matches/player/player-puuid/detailed",
    );
    expect(validatedGet.mock.calls[0]?.[2]).toEqual({
      queues: "420",
      // An empty search is "no filter", not a filter for empty strings:
      // sent as "", the backend would match nothing.
      search: undefined,
      start: 20,
      count: 10,
    });
    expect(
      queryClient.getQueryData([
        "match-history-detailed",
        "player-puuid",
        "420",
        "",
        3,
        10,
      ]),
    ).toEqual(detailed);
  });
});

describe("isMatchHistoryQuery", () => {
  // The keys come from the option factories above: the predicate's job is to
  // catch the caches those factories fill, whatever their filter arguments.
  it.each([
    [
      "the stats cache",
      matchHistoryStatsQueryOptions("player-puuid", "420").queryKey,
    ],
    [
      "the detailed cache",
      matchHistoryDetailedQueryOptions({
        puuid: "player-puuid",
        queueQueryParam: undefined,
        search: "katarina",
        page: 2,
        pageSize: 20,
      }).queryKey,
    ],
  ])("recognises %s for the player it was given", (_label, key) => {
    expect(isMatchHistoryQuery(key, "player-puuid")).toBe(true);
  });

  it.each([
    ["another player's cache", ["match-history-stats", "other-puuid", "420"]],
    ["a cache that is not match history", ["player-league", "player-puuid"]],
    ["no key at all", []],
  ])("rejects %s", (_label, key) => {
    expect(isMatchHistoryQuery(key, "player-puuid")).toBe(false);
  });
});
