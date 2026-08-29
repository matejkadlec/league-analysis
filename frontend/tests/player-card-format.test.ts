// `formatDate`'s own `timeZone: "UTC"` is the only thing keeping its output
// stable, and the gate container runs UTC. Works only because `formatDate`
// builds its formatter per call; if it caches one, use `test: { env: { TZ } }`.
process.env.TZ = "Pacific/Kiritimati";

import { describe, expect, it } from "vitest";

import { formatDate } from "@/features/players/player-card-format";

describe("the last-updated date", () => {
  it("reads the same clock everywhere it is rendered", () => {
    // This timestamp is half an hour before midnight UTC, so any zone east of
    // it prints the following day. Two people looking at the same player
    // should not see different days.
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
