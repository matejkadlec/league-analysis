import { QueryClient } from "@tanstack/react-query";
import { HttpResponse, http, type JsonBodyType } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { apiRoute } from "./support/api-route";
import { server } from "./support/msw-server";

import {
  championStatsQueryOptions,
  laneStatsQueryOptions,
} from "@/features/profile/profile-query";

const performance = {
  games_played: 12,
  wins: 8,
  losses: 4,
  win_rate: 0.67,
  avg_kills: 5.2,
  avg_deaths: 3.1,
  avg_assists: 7.4,
  avg_kda: 4.06,
};

const championStats = {
  puuid: "player-puuid",
  total_champions: 1,
  champions: [
    { champion_name: "Katarina", champion_id: 55, ...performance },
  ],
};

const laneStats = {
  puuid: "player-puuid",
  total_lanes: 1,
  lanes: [{ lane: "Mid", ...performance }],
};

/** The query string of every request the API actually received. */
const received: Record<string, string>[] = [];

/** Serve one route, and only that route: anything else reaches no handler and
 * `onUnhandledRequest: "error"` fails the request the card depends on. */
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

describe("the profile cards' two aggregate reads", () => {
  beforeEach(() => {
    received.length = 0;
  });

  it("asks for champion stats over ranked solo only, under the player's own key", async () => {
    // These cards are ranked standings: the queue is fixed, and the key
    // carries it so a future second queue cannot collide with this cache.
    serve("/matches/player/player-puuid/champion-stats", championStats);
    const queryClient = retryFreeClient();

    await queryClient.fetchQuery(championStatsQueryOptions("player-puuid"));

    expect(received).toEqual([{ queues: "420" }]);
    expect(
      queryClient.getQueryData(["champion-stats", "player-puuid", 420]),
    ).toEqual(championStats);
  });

  it("asks for lane stats over the same ranked-solo scope", async () => {
    serve("/matches/player/player-puuid/lane-stats", laneStats);
    const queryClient = retryFreeClient();

    await queryClient.fetchQuery(laneStatsQueryOptions("player-puuid"));

    expect(received).toEqual([{ queues: "420" }]);
    expect(
      queryClient.getQueryData(["lane-stats", "player-puuid", 420]),
    ).toEqual(laneStats);
  });

  it("keeps the two cards' caches separate", () => {
    // The overview route composes both cards; a shared root would let
    // whichever loaded first answer the other with the wrong shape.
    expect(championStatsQueryOptions("player-puuid").queryKey).not.toEqual(
      laneStatsQueryOptions("player-puuid").queryKey,
    );
  });
});
