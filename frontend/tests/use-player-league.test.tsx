// @vitest-environment jsdom

import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { validatedGet } = vi.hoisted(() => ({
  validatedGet: vi.fn<typeof import("@/lib/core/http/api").validatedGet>(),
}));

vi.mock("@/lib/core/http/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/http/api")>()),
  validatedGet,
}));

import { usePlayerLeague } from "@/features/players/components/use-player-league";
import {
  PlayerLeagueSchema,
  type PlayerLeague,
} from "@/lib/core/schemas";
import { renderHookWithQueryClient } from "./support/render-support";

/** Parsed through the real schema so the raw percentage the API serves
 * becomes the fraction the app standardises on, exactly as the boundary does. */
function league(): PlayerLeague {
  return PlayerLeagueSchema.parse({
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
  });
}

function renderLeague() {
  return renderHookWithQueryClient(() => usePlayerLeague("player-puuid"));
}

describe("the player's current ranked-solo standing", () => {
  beforeEach(() => validatedGet.mockReset());

  it("reads it under the player's own key, with the win rate as a fraction", async () => {
    validatedGet.mockResolvedValue({ success: true, data: league() });
    const { result, queryClient } = renderLeague();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(validatedGet).toHaveBeenCalledTimes(1);
    expect(validatedGet.mock.calls[0]?.[1]).toBe("/players/player-puuid/league");
    expect(validatedGet.mock.calls[0]?.[2]?.params).toBeUndefined();
    expect(result.current.data?.display_rank).toBe("Gold II");
    // The API serves this one win rate as a percentage; the app reads 0-1.
    expect(result.current.data?.win_rate).toBe(0.62);
    expect(queryClient.getQueryData(["player-league", "player-puuid"])).toEqual(
      league(),
    );
  });

  it("reads an unranked player's 200 null as data, not as a failure", async () => {
    // `/players/{puuid}/league` never 404s: unranked is a 200 carrying
    // `null`, and only that shape may render as "unranked".
    validatedGet.mockResolvedValue({ success: true, data: null });
    const { result } = renderLeague();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toBeNull();
    expect(result.current.isError).toBe(false);
  });

  it("lets a failed read reach the error state rather than reading as unranked", async () => {
    validatedGet.mockResolvedValue({
      success: false,
      error: {
        message: "The League Analysis service could not complete the request.",
        kind: "service",
        status: 503,
      },
    });
    const { result } = renderLeague();

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.data).toBeUndefined();
  });

  it("keeps a just-read standing fresh for a minute", async () => {
    // The card and the tracked-players list can both be on screen; without
    // the staleTime each mount refetches a rank that moves per match, not
    // per render.
    validatedGet.mockResolvedValue({ success: true, data: league() });
    const { result } = renderLeague();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.isStale).toBe(false);
  });
});
