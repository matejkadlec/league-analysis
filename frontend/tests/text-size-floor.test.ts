/**
 * LGA-101's size floor, read from source rather than a render: it has to hold
 * for every line, not the handful a browser test samples.
 */

import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Directories are read rather than listed, since a hand-kept list goes stale;
 * `player-selector.tsx` belongs to neither and is named explicitly.
 */
function componentsIn(directory: string): string[] {
  return readdirSync(directory)
    .filter((entry) => entry.endsWith(".tsx"))
    .sort()
    .map((entry) => `${directory}/${entry}`);
}

const SURFACES: Record<string, readonly string[]> = {
  "Rank Manipulation": [
    "app/rank-manipulation/page.tsx",
    "features/players/components/player-selector.tsx",
    ...componentsIn("features/smurf-boost/components"),
  ],
  "Matchmaking Analysis": [
    "app/matchmaking-analysis/page.tsx",
    ...componentsIn("features/matchmaking/components"),
  ],
};

/** Every class on the surface that resolves to less than 14px. */
function offendersIn(paths: readonly string[]): string[] {
  const offenders: string[] = [];

  for (const path of paths) {
    const source = readFileSync(path, "utf8");

    // `text-xs` is the only token below 14px, but `text-[0.6875rem]` slips past
    // a token ban, so arbitrary sizes are read and compared, not matched.
    if (/\btext-xs\b/.test(source)) {
      offenders.push(`${path}: text-xs`);
    }

    for (const [, value, unit] of source.matchAll(
      /\btext-\[([\d.]+)(rem|px)\]/g,
    )) {
      const pixels = unit === "rem" ? Number(value) * 16 : Number(value);
      if (pixels < 14) {
        offenders.push(`${path}: text-[${value}${unit}] is ${pixels}px`);
      }
    }
  }

  return offenders;
}

describe.each(Object.entries(SURFACES))("%s", (_surface, paths) => {
  it("scans the files it is written against", () => {
    // A moved or renamed page would otherwise drop out silently, and the count
    // guards the other way: an empty directory passes every check below.
    for (const path of paths) {
      expect(() => readFileSync(path, "utf8"), path).not.toThrow();
    }
    expect(paths.length).toBeGreaterThan(2);
  });

  it("has no text under 14px left anywhere on it", () => {
    // LGA-101 asks for the whole page, not the one example it names, and a
    // browser test can only measure the nodes it thinks to sample.
    expect(offendersIn(paths)).toEqual([]);
  });
});
