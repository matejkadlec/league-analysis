// @vitest-environment jsdom

import { waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { apiRoute } from "./support/api-route";
import { server } from "./support/msw-server";

import { usePlayerLeague } from "@/features/players/components/use-player-league";
import { renderHookWithQueryClient } from "./support/render-support";

/** What the API serves for a ranked player, win rate included as the
 * percentage it sends rather than the fraction the app reads. */
const LEAGUE_PAYLOAD = {
  puuid: "player-puuid",
  queue_type: "RANKED_SOLO_5x5",
  tier: "GOLD",
  rank: "II",
  league_points: 42,
  wins: 30,
  losses: 20,
  created_at: "2026-08-01T00:00:00Z",
  win_rate: 62,
  total_games: 50,
  display_rank: "Gold II",
};

/** The query string of every league request that reached the API. */
const received: (string | null)[] = [];

function serveLeague(respond: () => Response) {
  server.use(
    http.get(apiRoute("/players/player-puuid/league"), ({ request }) => {
      received.push(new URL(request.url).search || null);
      return respond();
    }),
  );
}

function renderLeague() {
  return renderHookWithQueryClient(() => usePlayerLeague("player-puuid"));
}

describe("the player's current ranked-solo standing", () => {
  beforeEach(() => {
    received.length = 0;
  });

  it("reads it under the player's own key, with the win rate as a fraction", async () => {
    serveLeague(() => HttpResponse.json(LEAGUE_PAYLOAD));
    const { result, queryClient } = renderLeague();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // One unfiltered read: the standing is the player's, so nothing narrows it.
    expect(received).toEqual([null]);
    expect(result.current.data?.display_rank).toBe("Gold II");
    // The API serves this one win rate as a percentage; the app reads 0-1.
    expect(result.current.data?.win_rate).toBe(0.62);
    expect(queryClient.getQueryData(["player-league", "player-puuid"])).toEqual(
      { ...LEAGUE_PAYLOAD, win_rate: 0.62 },
    );
  });

  it("reads an unranked player's 200 null as data, not as a failure", async () => {
    // `/players/{puuid}/league` never 404s: unranked is a 200 carrying
    // `null`, and only that shape may render as "unranked".
    serveLeague(() => HttpResponse.json(null));
    const { result } = renderLeague();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toBeNull();
    expect(result.current.isError).toBe(false);
  });

  it("lets a failed read reach the error state rather than reading as unranked", async () => {
    serveLeague(() => new HttpResponse(null, { status: 503 }));
    const { result } = renderLeague();

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.data).toBeUndefined();
  });

  it("keeps a just-read standing fresh for a minute", async () => {
    // The card and the tracked-players list can both be on screen; without
    // the staleTime each mount refetches a rank that moves per match, not
    // per render.
    serveLeague(() => HttpResponse.json(LEAGUE_PAYLOAD));
    const { result } = renderLeague();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.isStale).toBe(false);
  });
});
