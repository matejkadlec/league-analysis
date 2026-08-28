import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { validatedGet } = vi.hoisted(() => ({
  validatedGet: vi.fn<typeof import("@/lib/core/http/api").validatedGet>(),
}));

vi.mock("@/lib/core/http/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/http/api")>()),
  validatedGet,
}));

import {
  playerQueryKey,
  playerQueryOptions,
} from "@/features/players/player-query";

const player = {
  puuid: "player-puuid",
  game_name: "Player",
  tag_line: "TAG",
  platform: "eun1",
  is_tracked: true,
  analyzed_matches: 20,
  total_matches: 20,
  created_at: "2026-08-10T00:00:00Z",
  updated_at: "2026-08-10T00:00:00Z",
};

describe("playerQueryOptions", () => {
  beforeEach(() => validatedGet.mockReset());

  it("stores one validated raw Player shape under the shared cache key", async () => {
    validatedGet.mockResolvedValue({ success: true, data: player });
    const queryClient = new QueryClient();

    const result = await queryClient.fetchQuery(
      playerQueryOptions(player.puuid),
    );

    expect(result).toEqual(player);
    expect(queryClient.getQueryData(playerQueryKey(player.puuid))).toEqual(
      player,
    );
    expect(result).not.toHaveProperty("success");
  });

  it("rejects invalid API results instead of caching an envelope", async () => {
    validatedGet.mockResolvedValue({
      success: false,
      error: { message: "Player unavailable", kind: "service" },
    });
    const queryClient = new QueryClient();

    await expect(
      queryClient.fetchQuery(playerQueryOptions(player.puuid)),
    ).rejects.toThrow("Player unavailable");
    expect(
      queryClient.getQueryData(playerQueryKey(player.puuid)),
    ).toBeUndefined();
  });
});
