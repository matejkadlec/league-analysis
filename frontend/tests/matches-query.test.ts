import { QueryClient } from "@tanstack/react-query";
import { HttpResponse, http, type JsonBodyType } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { apiRoute } from "./support/api-route";
import { server } from "./support/msw-server";

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

/** The query string of every request the API actually received. */
const received: Record<string, string>[] = [];

/** Serve one route, and only that route: a request to any other path reaches
 * no handler, and `onUnhandledRequest: "error"` fails it. */
function serve(path: string, body: JsonBodyType) {
  server.use(
    http.get(apiRoute(path), ({ request }) => {
      received.push(Object.fromEntries(new URL(request.url).searchParams));
      return HttpResponse.json(body);
    }),
  );
}

function retryFreeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe("the match history caches", () => {
  beforeEach(() => {
    received.length = 0;
  });

  it("scopes the stats read to the player and the queue filter", async () => {
    serve("/matches/player/player-puuid/stats", stats);
    const queryClient = retryFreeClient();

    await queryClient.fetchQuery(
      matchHistoryStatsQueryOptions("player-puuid", "420"),
    );

    expect(received).toEqual([{ queues: "420" }]);
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
    serve("/matches/player/player-puuid/detailed", detailed);
    const queryClient = retryFreeClient();

    await queryClient.fetchQuery(
      matchHistoryDetailedQueryOptions({
        puuid: "player-puuid",
        queueQueryParam: "420",
        search: "",
        page: 3,
        pageSize: 10,
      }),
    );

    // No `search` key at all, not an empty one: sent as "", the backend
    // would match nothing rather than everything.
    expect(received).toEqual([{ queues: "420", start: "20", count: "10" }]);
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
