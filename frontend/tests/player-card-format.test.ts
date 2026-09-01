// The gate container runs UTC, so only a non-UTC zone here exposes a missing
// `timeZone: "UTC"`; set before import because `formatDate` formats per call.
process.env.TZ = "Pacific/Kiritimati";

import { describe, expect, it } from "vitest";

import { formatDate } from "@/features/players/player-card-format";

describe("the last-updated date", () => {
  it("reads the same clock everywhere it is rendered", () => {
    // Half an hour before midnight UTC: any zone east of it prints the next day.
    expect(formatDate("2026-03-04T23:30:00Z")).toBe("Mar 4, 2026, 11:30 PM");
  });

  it("is running under a zone that would expose a missing one", () => {
    // Guards the test above: if the ambient zone were ever UTC, the assertion
    // would pass whether or not `formatDate` asked for UTC at all.
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).not.toBe("UTC");
  });

  it("says Never rather than inventing a date", () => {
    // `new Date(null)` is the epoch, so without the guard the card claims 1970.
    expect(formatDate(null)).toBe("Never");
    expect(formatDate(undefined)).toBe("Never");
    expect(formatDate("")).toBe("Never");
  });
});
