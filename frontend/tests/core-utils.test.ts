import { describe, expect, it } from "vitest";

import { PLATFORMS, getPlatformDisplayName } from "../lib/core/riot/platform-utils";
import { getRankColors } from "../features/players/utils/rank-colors";
import { TierSchema } from "../lib/core/schemas";

describe("platform presentation", () => {
  it("names every platform it is given", () => {
    // The parameter is `Platform`, so there is no unknown-code case left to
    // test -- `PlayerSchema` rejects the payload before this is ever called.
    for (const platform of PLATFORMS) {
      expect(getPlatformDisplayName(platform)).toBeTruthy();
    }
    expect(getPlatformDisplayName("eun1")).toBe("EUNE");
  });
});

describe("rank styling", () => {
  it("styles every tier the API can send", () => {
    // The parameter is `Tier`, so the unknown-tier branch is gone. What is worth
    // pinning is that the table covers the enum, since a tier added to
    // `TierSchema` without a colour is a type error only if the table is exhaustive.
    for (const tier of TierSchema.options) {
      expect(getRankColors(tier).text).toBeTruthy();
    }
    expect(getRankColors("GOLD").text).toContain("yellow");
  });
});
