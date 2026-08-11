import { describe, expect, it } from "vitest";

import {
  isPlayerCentricPath,
  playerOverviewRoute,
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

  it("uses Player Overview outside a player page and for compatibility", () => {
    expect(
      playerRoute("/settings", new URLSearchParams(), "player-1"),
    ).toBe("/player-overview?puuid=player-1");
    expect(playerOverviewRoute("player/1")).toBe(
      "/player-overview?puuid=player%2F1",
    );
    expect(playerOverviewRoute()).toBe("/player-overview");
  });
});
