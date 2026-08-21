import { describe, expect, it } from "vitest";

import { PLATFORMS, getPlatformDisplayName } from "../lib/core/platform-utils";
import { getRankColors } from "../features/players/utils/rank-colors";

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
  it("normalizes known tiers and keeps unknown tiers neutral", () => {
    expect(getRankColors("gold").text).toContain("yellow");
    expect(getRankColors("unknown").gradient).toBe(
      "from-gray-500/10 to-gray-600/10",
    );
  });
});
