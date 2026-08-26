import { describe, expect, it } from "vitest";

import { formatRunEndDate, formatRunType } from "@/features/matchmaking/run-type";

describe("formatRunType", () => {
  it("labels a latest-window run by its count", () => {
    expect(formatRunType({ match_count: 10, end_date: null })).toBe(
      "10 · latest",
    );
  });

  it("labels a backdated run with its UTC day, not a local shift", () => {
    // Parsed without the Z suffix, Feb 1 becomes Jan 31 west of Greenwich.
    expect(formatRunType({ match_count: 30, end_date: "2026-02-01" })).toBe(
      "30 · through Feb 1, 2026",
    );
  });
});

describe("formatRunEndDate", () => {
  it("renders the stored day itself", () => {
    expect(formatRunEndDate("2026-07-26")).toBe("Jul 26, 2026");
  });
});
