import { describe, expect, it } from "vitest";

import {
  formatDateTime,
  formatFractionAsPercent,
  winRateColors,
} from "@/lib/core/format";

describe("the shared win rate colours", () => {
  // One copy now serves the player card and both profile cards; these bands
  // used to exist in three files. Text and bar come from the same verdict,
  // so a green number can never sit over a red bar.
  it.each([
    [0.51, "text-green-500", "bg-green-500"],
    [0.509, "text-yellow-500", "bg-yellow-500"],
    [0.5, "text-yellow-500", "bg-yellow-500"],
    [0.491, "text-yellow-500", "bg-yellow-500"],
    [0.49, "text-rose-500", "bg-rose-500"],
    [0, "text-rose-500", "bg-rose-500"],
    [1, "text-green-500", "bg-green-500"],
  ])("draws a %s fraction in matching colours", (fraction, text, bar) => {
    expect(winRateColors(fraction)).toEqual({ text, bar });
  });
});

describe("the percent formatter", () => {
  it("formats a 0-1 fraction and only a fraction", () => {
    // The helper this replaced guessed its unit (`<= 1 ? * 100 : as-is`), so
    // a ranked player between 0 and 1 percent rendered as 100%. The unit is
    // now part of the contract: a sub-1% win rate is a sub-1% win rate.
    expect(formatFractionAsPercent(0.625)).toBe("62.5%");
    expect(formatFractionAsPercent(0.005)).toBe("0.5%");
    expect(formatFractionAsPercent(1)).toBe("100%");
  });

  it("drops a trailing zero rather than printing it", () => {
    expect(formatFractionAsPercent(0.5)).toBe("50%");
    expect(formatFractionAsPercent(0)).toBe("0%");
  });
});

describe("the shared local-time clock", () => {
  // Fixtures are built in local time and read back in local time, so these
  // say the same thing in every timezone the gate or a laptop runs under.

  it("renders midnight as 12 AM, with padded minutes and seconds", () => {
    // The two things worth pinning are the 24-to-12 hour conversion, which
    // reads 0:05 as 12:05, and the padding that keeps 3:5:7 from a viewer.
    const localMidnight = new Date(2026, 0, 2, 0, 5, 7);

    expect(formatDateTime(localMidnight.toISOString(), { seconds: true })).toBe(
      "2.1.2026 12:05:07 AM",
    );
  });

  it("renders noon as 12 PM rather than 0 PM", () => {
    const localNoon = new Date(2026, 0, 2, 12, 30, 0);

    expect(formatDateTime(localNoon.toISOString(), { seconds: true })).toBe(
      "2.1.2026 12:30:00 PM",
    );
  });

  it("leaves the seconds off unless asked", () => {
    const localMidnight = new Date(2026, 0, 2, 0, 5, 7);

    expect(formatDateTime(localMidnight.toISOString())).toBe(
      "2.1.2026 12:05 AM",
    );
  });

  it("accepts an epoch-millisecond timestamp", () => {
    // match-row feeds game_start_timestamp as a raw number.
    const local = new Date(2026, 0, 2, 14, 7);

    expect(formatDateTime(local.getTime())).toBe("2.1.2026 2:07 PM");
  });

  it("says nothing legible-looking about a timestamp it cannot parse", () => {
    // Without the guard an unparseable string renders "NaN.NaN.NaN 12:NaN AM"
    // in the job log viewer, which reads like a broken clock, not bad data.
    expect(formatDateTime("")).toBe("—");
    expect(formatDateTime("not a date", { seconds: true })).toBe("—");
  });
});
