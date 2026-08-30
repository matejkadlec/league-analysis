import { QueryClient } from "@tanstack/react-query";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { apiRoute } from "./support/api-route";
import { server } from "./support/msw-server";

import {
  playerQueryKey,
  playerQueryOptions,
} from "@/features/players/player-query";

/** What `/players/{puuid}` puts on the wire, whole enough to satisfy the
 * schema the query parses it with. */
const player = {
  puuid: "player-puuid",
  game_name: "Player",
  tag_line: "TAG",
  platform: "eun1",
  summoner_level: 312,
  profile_icon_id: 4568,
  is_tracked: true,
  analyzed_matches: 20,
  total_matches: 20,
  created_at: "2026-08-10T00:00:00Z",
  updated_at: "2026-08-10T00:00:00Z",
};

function retryFreeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe("playerQueryOptions", () => {
  it("stores one validated raw Player shape under the shared cache key", async () => {
    server.use(
      http.get(apiRoute("/players/player-puuid"), () =>
        HttpResponse.json(player),
      ),
    );
    const queryClient = retryFreeClient();

    const result = await queryClient.fetchQuery(
      playerQueryOptions(player.puuid),
    );

    expect(result).toEqual(player);
    expect(queryClient.getQueryData(playerQueryKey(player.puuid))).toEqual(
      player,
    );
    expect(result).not.toHaveProperty("success");
  });

  it("rejects a response the schema does not recognise instead of caching it", async () => {
    // Cached, a half-shape renders as a player whose name and rank are
    // blank; thrown, it reaches the error state the QueryCache toasts.
    server.use(
      http.get(apiRoute("/players/player-puuid"), () =>
        HttpResponse.json({ puuid: player.puuid }),
      ),
    );
    const queryClient = retryFreeClient();

    await expect(
      queryClient.fetchQuery(playerQueryOptions(player.puuid)),
    ).rejects.toThrow(
      "The League Analysis service returned an unexpected response. Please try again later.",
    );
    expect(
      queryClient.getQueryData(playerQueryKey(player.puuid)),
    ).toBeUndefined();
  });
});
