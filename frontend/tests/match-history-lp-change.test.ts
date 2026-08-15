import { describe, expect, it } from "vitest";

import { formatMatchLpChange } from "@/features/matches/utils/lp-change";

describe("Match History LP changes", () => {
  it.each([
    [18, false, "+18 LP"],
    [-16, false, "-16 LP"],
    [0, true, "+0 LP"],
    [0, false, "0 LP"],
    [null, false, "— LP"],
    [undefined, false, "— LP"],
  ])("formats %s with a neutral unavailable state", (value, remake, text) => {
    expect(formatMatchLpChange(value, remake)).toBe(text);
  });
});
