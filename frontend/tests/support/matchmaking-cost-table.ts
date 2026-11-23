import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DOCUMENT = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../docs/matchmaking-analysis.md",
);

export interface DocumentedColdRun {
  matchCount: number;
  matchV5: number;
  leagueV4: number;
  total: number;
  /** The duration cell without its "about", e.g. "20 min". */
  duration: string;
}

const number = (cell: string) => Number(cell.replaceAll(",", ""));

/**
 * The cost table in `docs/matchmaking-analysis.md`, which the backend's
 * `test_matchmaking_analysis_schemas.py` reads too: the one fixture both
 * formulas and the start card's duration are held to (LGA-147).
 */
export function documentedColdRuns(): DocumentedColdRun[] {
  const rows = readFileSync(DOCUMENT, "utf8").matchAll(
    /^\| (\d+) \| ([\d,]+) \| ([\d,]+) \| ([\d,]+) \| about ([^|]+?) \|$/gm,
  );
  return [...rows].map(([, size, matchV5, leagueV4, total, duration]) => ({
    matchCount: number(size as string),
    matchV5: number(matchV5 as string),
    leagueV4: number(leagueV4 as string),
    total: number(total as string),
    duration: duration as string,
  }));
}
