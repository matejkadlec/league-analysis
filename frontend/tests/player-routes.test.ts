import { describe, expect, it } from "vitest";

import {
  isPlayerCentricPath,
  playerNavigationRoute,
  playerRoute,
} from "../features/players/player-routes";

describe("player routes", () => {
  it("keeps explicit PUUID navigation on current player pages", () => {
    expect(
      playerRoute(
        "/match-history",
        new URLSearchParams("queue=420&puuid=old"),
        "new/player",
      ),
    ).toBe("/match-history?queue=420&puuid=new%2Fplayer");
    expect(isPlayerCentricPath("/player-overview")).toBe(true);
    expect(isPlayerCentricPath("/match-history")).toBe(true);
  });

  it("leaves the locally scoped analysis pages out", () => {
    // Both carry `?puuid=`, and on both it names a page-local analysis target.
    // Treating either as player-centric would let `playerNavigationRoute`
    // promote that local choice to the account's current player.
    expect(isPlayerCentricPath("/rank-manipulation")).toBe(false);
    expect(isPlayerCentricPath("/matchmaking-analysis")).toBe(false);
  });

  it("uses Player Overview outside a player page", () => {
    expect(
      playerRoute("/settings", new URLSearchParams(), "player-1"),
    ).toBe("/player-overview?puuid=player-1");
  });

  it("keeps the URL-selected PUUID in both player navigation targets", () => {
    expect(playerNavigationRoute("/player-overview", "player/1")).toBe(
      "/player-overview?puuid=player%2F1",
    );
    expect(playerNavigationRoute("/match-history", "player/1")).toBe(
      "/match-history?puuid=player%2F1",
    );
    expect(playerNavigationRoute("/rank-manipulation", "player/1")).toBe(
      "/rank-manipulation",
    );
    expect(playerNavigationRoute("/matchmaking-analysis", "player/1")).toBe(
      "/matchmaking-analysis",
    );
    expect(playerNavigationRoute("/match-history")).toBe("/match-history");
  });
});
