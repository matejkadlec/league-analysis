import { describe, expect, it } from "vitest";

import { getPlatformDisplayName, getPlatformFlag } from "../lib/core/platform-utils";
import { playerSearchSchema } from "../lib/core/validations";
import { getRankColors } from "../features/players/utils/rank-colors";

describe("player search validation", () => {
  it("trims a valid Riot ID and preserves a supported platform", () => {
    const result = playerSearchSchema.parse({
      searchValue: "  Player#EUN1  ",
      platform: "eun1",
    });

    expect(result).toEqual({ searchValue: "Player#EUN1", platform: "eun1" });
  });

  it("rejects oversized names, tag lines, and unsupported platforms", () => {
    expect(
      playerSearchSchema.safeParse({
        searchValue: `${"p".repeat(17)}#EUN1`,
        platform: "eun1",
      }).success,
    ).toBe(false);
    expect(
      playerSearchSchema.safeParse({
        searchValue: "Player#TOOLONG",
        platform: "eun1",
      }).success,
    ).toBe(false);
    expect(
      playerSearchSchema.safeParse({
        searchValue: "Player#EUN1",
        platform: "invalid",
      }).success,
    ).toBe(false);
  });
});

describe("platform presentation", () => {
  it("normalizes known platform codes case-insensitively", () => {
    expect(getPlatformDisplayName("EUN1")).toBe("EUNE");
    expect(getPlatformFlag("eUn1")).toBe("🇪🇺");
  });

  it("uses safe fallbacks for unknown platforms", () => {
    expect(getPlatformDisplayName("test")).toBe("TEST");
    expect(getPlatformFlag("test")).toBe("🌐");
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
