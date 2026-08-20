import { describe, expect, it } from "vitest";

import { getPlatformDisplayName } from "../lib/core/platform-utils";
import { getRankColors } from "../features/players/utils/rank-colors";

describe("platform presentation", () => {
  it("normalizes known platform codes case-insensitively", () => {
    expect(getPlatformDisplayName("EUN1")).toBe("EUNE");
  });

  it("uses safe fallbacks for unknown platforms", () => {
    expect(getPlatformDisplayName("test")).toBe("TEST");
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
