// The zone is set before anything reads `Intl`, so `formatDate`'s own
// `timeZone: "UTC"` is the only thing keeping its output stable here. Without
// this line the gate container runs UTC, the ambient zone and the requested
// one agree, and dropping that option changes nothing that any assertion
// could see -- the mutation would survive in CI and only misbehave on the
// machines people actually use. UTC+14 is far enough that it moves the day.
process.env.TZ = "Pacific/Kiritimati";

import { describe, expect, it } from "vitest";

import {
  formatDate,
  formatWinRate,
  getWinRateBarColor,
  getWinRateColor,
} from "@/features/players/components/player-card-format";

describe("the player card's win rate colours", () => {
  // The two helpers are read off the same number, one for the figure and one
  // for the bar under it, so a threshold that drifts between them shows a
  // green number over a red bar.
  it.each([
    [51, "text-green-500", "bg-green-500"],
    [50, "text-yellow-500", "bg-yellow-500"],
    [49.1, "text-yellow-500", "bg-yellow-500"],
    [49, "text-rose-500", "bg-rose-500"],
    [0, "text-rose-500", "bg-rose-500"],
    [100, "text-green-500", "bg-green-500"],
  ])("draws %s%% in matching colours", (winRate, text, bar) => {
    expect(getWinRateColor(winRate)).toBe(text);
    expect(getWinRateBarColor(winRate)).toBe(bar);
  });

  it("treats 51 as good and 49 as bad, not the other way round", () => {
    // Both boundaries are inclusive on one side only, and the band between
    // them is deliberately narrow. Moving either edge by one re-colours every
    // player sitting on it.
    expect(getWinRateColor(51)).toBe("text-green-500");
    expect(getWinRateColor(50.9)).toBe("text-yellow-500");
    expect(getWinRateColor(49)).toBe("text-rose-500");
  });
});

describe("the win rate figure", () => {
  it("accepts both a fraction and a percentage", () => {
    // The two callers disagree on units: a ranked league sends 0-100 and the
    // unranked match stats send 0-1. This function is what reconciles them,
    // and it is the only thing doing so -- the same component passes the
    // stats value multiplied for the colour and unmultiplied for the text.
    expect(formatWinRate(0.625)).toBe("62.5");
    expect(formatWinRate(62.5)).toBe("62.5");
    expect(formatWinRate(1)).toBe("100");
    expect(formatWinRate(100)).toBe("100");
  });

  it("drops a trailing zero rather than printing it", () => {
    expect(formatWinRate(50)).toBe("50");
    expect(formatWinRate(0.5)).toBe("50");
    expect(formatWinRate(0)).toBe("0");
  });
});

describe("the last-updated date", () => {
  it("reads the same clock everywhere it is rendered", () => {
    // This timestamp is half an hour before midnight UTC, so any zone east of
    // it prints the following day. The value describes when the server last
    // synced a player, and two people looking at the same player should not
    // see different days.
    expect(formatDate("2026-03-04T23:30:00Z")).toBe("Mar 4, 2026, 11:30 PM");
  });

  it("is running under a zone that would expose a missing one", () => {
    // Guards the test above: if the ambient zone were ever UTC, the assertion
    // would pass whether or not `formatDate` asked for UTC at all.
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).not.toBe("UTC");
  });

  it("says Never rather than inventing a date", () => {
    // A player who has never been synced has a null here, and `new Date(null)`
    // is the epoch -- so without the guard the card claims the player was last
    // updated on 1 January 1970.
    expect(formatDate(null)).toBe("Never");
    expect(formatDate(undefined)).toBe("Never");
    expect(formatDate("")).toBe("Never");
  });
});
