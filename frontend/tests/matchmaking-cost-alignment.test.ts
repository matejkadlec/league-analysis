import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ANALYSIS_MATCH_COUNT,
  coldRunRequestsByHost,
  estimateColdRunMinutes,
  formatRunDuration,
} from "@/features/matchmaking/matchmaking-progress";

import { documentedColdRuns } from "./support/matchmaking-cost-table";

const BACKEND_SCHEMAS = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../backend/app/features/matchmaking_analysis/schemas.py",
);

/**
 * The start card's count and estimate are hand copies of the backend's, and
 * the backend test holds its formulas to the same documented table, so a
 * change either side misses fails one of them (LGA-147).
 */
describe("the matchmaking cold-run cost against the backend", () => {
  const rows = documentedColdRuns();

  it("reads the documented table", () => {
    // Signal first: a parse that matched nothing makes the rest vacuous.
    expect(rows.map((row) => row.matchCount)).toEqual([ANALYSIS_MATCH_COUNT]);
  });

  it("sends the count the backend fixes", () => {
    const fixed = /^MATCH_COUNT = (\d+)$/m.exec(
      readFileSync(BACKEND_SCHEMAS, "utf8"),
    );

    expect(fixed?.[1]).toBeDefined();
    expect(Number(fixed?.[1])).toBe(ANALYSIS_MATCH_COUNT);
  });

  it("counts each host's requests as the document does", () => {
    for (const row of rows) {
      const { matchV5, leagueV4 } = coldRunRequestsByHost(row.matchCount);

      expect(matchV5).toBe(row.matchV5);
      expect(leagueV4).toBe(row.leagueV4);
      expect(matchV5 + leagueV4).toBe(row.total);
    }
  });

  it("estimates the documented duration", () => {
    for (const row of rows) {
      expect(formatRunDuration(estimateColdRunMinutes(row.matchCount))).toBe(
        row.duration,
      );
    }
  });

  it("paces a run by its busier host, not by every request together", () => {
    // Application limits apply per routing host: the rank reads spend the
    // platform host's budget, not the regional one MATCH-V5 waits on.
    const { matchV5, leagueV4 } = coldRunRequestsByHost(ANALYSIS_MATCH_COUNT);
    // 100 requests per 120 s, the development key's long window.
    const minutes = (requests: number) => Math.round((requests / 100) * 2);

    expect(estimateColdRunMinutes(ANALYSIS_MATCH_COUNT)).toBe(minutes(matchV5));
    // The distinction is visible at the fixed count: one window queue for
    // both hosts would overstate the run.
    expect(minutes(matchV5 + leagueV4)).toBeGreaterThan(minutes(matchV5));
  });
});
