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
  lanes: [{ lane: "Middle", ...performance }],
};

describe("the profile cards' two aggregate reads", () => {
  beforeEach(() => validatedGet.mockReset());

  it("asks for champion stats over ranked solo only, under the player's own key", async () => {
    // These cards are ranked standings: the queue is fixed, and the key
    // carries it so a future second queue cannot collide with this cache.
    validatedGet.mockResolvedValue({ success: true, data: championStats });
    const queryClient = new QueryClient();

    await queryClient.fetchQuery(championStatsQueryOptions("player-puuid"));

    expect(validatedGet.mock.calls[0]?.[1]).toBe(
      "/matches/player/player-puuid/champion-stats",
    );
    expect(validatedGet.mock.calls[0]?.[2]?.params).toEqual({ queues: "420" });
    expect(
      queryClient.getQueryData(["champion-stats", "player-puuid", 420]),
    ).toEqual(championStats);
  });

  it("asks for lane stats over the same ranked-solo scope", async () => {
    validatedGet.mockResolvedValue({ success: true, data: laneStats });
    const queryClient = new QueryClient();

    await queryClient.fetchQuery(laneStatsQueryOptions("player-puuid"));

    expect(validatedGet.mock.calls[0]?.[1]).toBe(
      "/matches/player/player-puuid/lane-stats",
    );
    expect(validatedGet.mock.calls[0]?.[2]?.params).toEqual({ queues: "420" });
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
