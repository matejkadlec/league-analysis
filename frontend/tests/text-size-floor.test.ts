import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * LGA-101's size floor, for every analysis surface held to it. Source text
 * rather than a render: this has to hold for every line, not the handful a
 * browser test samples.
 */
/**
 * Every file that renders part of each surface. The component directories are
 * read rather than listed, since a hand-kept list goes stale.
 * `player-selector.tsx` is named explicitly, belonging to neither directory.
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

    // `text-xs` is the only token below 14px, but an arbitrary value slips past a
    // token ban: `text-[0.6875rem]` did exactly that on two surfaces in turn. So
    // arbitrary sizes are read and compared, not pattern-matched.
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
    // Aimed at what is not derived: a page or shared control that was moved or
    // renamed would otherwise drop out silently. The count guards the other
    // direction -- an empty directory would pass every check below.
    for (const path of paths) {
      expect(() => readFileSync(path, "utf8"), path).not.toThrow();
    }
    expect(paths.length).toBeGreaterThan(2);
  });

  it("has no text under 14px left anywhere on it", () => {
    // LGA-101 asks for the whole page rather than the one example it names. A
    // browser test can only measure the nodes it thinks to sample; this sees every
    // line, including the ones a shared control brings with it.
    expect(offendersIn(paths)).toEqual([]);
  });
});
