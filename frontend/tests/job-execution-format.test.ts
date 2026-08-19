import { describe, expect, it } from "vitest";

import {
  apiCallKey,
  detailedLogKey,
  formatApiCallParamLabel,
  formatDateTime,
  formatDuration,
  formatRecordsSummary,
} from "../features/jobs/components/job-execution-format";

describe("how a job run is worded", () => {
  it.each([
    ["a run still going", null, "N/A"],
    ["under a minute", "2026-01-02T03:04:05.500Z", "0.5s"],
    ["exactly a minute", "2026-01-02T03:05:05.000Z", "1m 0s"],
    ["over a minute", "2026-01-02T03:05:12.000Z", "1m 7s"],
  ])("reports %s", (_label, completed, expected) => {
    expect(formatDuration("2026-01-02T03:04:05.000Z", completed)).toBe(
      expected,
    );
  });

  it.each([
    [0, 0, "No records created or updated"],
    [3, 4, "3 records created and 4 records updated"],
    [3, 0, "3 records created"],
    [0, 4, "4 records updated"],
  ])("summarises %i created and %i updated", (created, updated, expected) => {
    expect(formatRecordsSummary(created, updated)).toBe(expected);
  });

  it.each([
    [undefined, "Parameters"],
    ["puuid", "PUUIDs"],
    ["matchId", "Match IDs"],
    ["summonerName", "Summoner Names"],
  ])("labels the %s parameter column", (paramKey, expected) => {
    expect(formatApiCallParamLabel(paramKey)).toBe(expected);
  });

  it("renders midnight as 12 AM, with padded minutes and seconds", () => {
    // Built in local time and read back in local time, so this says the same
    // thing in every timezone the gate or a laptop happens to use. The two
    // things worth pinning are the 24-to-12 hour conversion, which reads 0:05
    // as 12:05, and the padding that keeps 3:5:7 from reaching a viewer.
    const localMidnight = new Date(2026, 0, 2, 0, 5, 7);

    expect(formatDateTime(localMidnight.toISOString())).toBe(
      "2.1.2026 12:05:07 AM",
    );
  });

  it("renders noon as 12 PM rather than 0 PM", () => {
    const localNoon = new Date(2026, 0, 2, 12, 30, 0);

    expect(formatDateTime(localNoon.toISOString())).toBe(
      "2.1.2026 12:30:00 PM",
    );
  });
});

describe("keys for rows React will reuse", () => {
  // These are React list keys. Two entries that differ must not collide, or
  // React keeps the first row mounted and the second one's numbers never
  // appear -- a wrong reading on screen, with nothing failing.

  it("separates API calls that differ only in their window", () => {
    const base = { endpoint: "/lol/match/v5/matches", region: "eun1", count: 2 };

    expect(
      apiCallKey({ ...base, first_timestamp: "1", last_timestamp: "2" }),
    ).not.toBe(
      apiCallKey({ ...base, first_timestamp: "1", last_timestamp: "3" }),
    );
  });

  it("separates log lines that differ only in a field neither names", () => {
    const base = { timestamp: "2026-01-02T03:04:05Z", level: "INFO", event: "fetched" };

    expect(detailedLogKey({ ...base, matches: 1 })).not.toBe(
      detailedLogKey({ ...base, matches: 2 }),
    );
  });

  it("gives a log line without a level the same shape as one with it", () => {
    // `level` defaults to INFO rather than "undefined", so a line missing it
    // still sorts and reads like the rest.
    expect(detailedLogKey({ timestamp: "t", event: "e" })).toBe(
      detailedLogKey({ timestamp: "t", event: "e", level: "INFO" }),
    );
  });
});
