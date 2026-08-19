// `formatDate`'s own `timeZone: "UTC"` is the only thing keeping its output
// stable here. Without this line the gate container runs UTC, the ambient zone
// and the requested one agree, and dropping that option changes nothing any
// assertion could see -- the mutation would survive in CI and only misbehave
// on the machines people actually use. UTC+14 is far enough to move the day.
//
// This is not "before anything reads `Intl`": ESM hoists the imports below
// above it, so the module under test evaluates first. It works because
// `formatDate` constructs its formatter per call. If that module ever caches
// an `Intl.DateTimeFormat` at module scope this line becomes a silent no-op --
// and the ambient-zone guard at the bottom of this file would not notice,
// because the ambient zone really is Kiritimati by then and only the captured
// one would be stale. The fix at that point is `test: { env: { TZ } }` in
// `vitest.config.mts`, which applies before any module evaluates.
//
// Safe to copy into another test file: vitest 4's default `pool: "forks"` with
// `isolate: true` gives each file its own process, so this does not reach any
// other file. Measured, not assumed -- under `--no-isolate` it does leak.
process.env.TZ = "Pacific/Kiritimati";

import { describe, expect, it } from "vitest";

import { formatDate } from "@/features/players/components/player-card-format";

// The win-rate colour and figure tests that lived here moved to
// tests/format.test.ts with the helpers themselves: three per-file copies
// (players, role card, champion card) are now one fraction-based module in
// lib/core/format.ts, and the unit-guessing formatWinRate is gone.

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
