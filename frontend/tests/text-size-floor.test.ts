import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * LGA-101's size floor, for every analysis surface that has been held to it.
 *
 * It began as one check inside `rank-manipulation-surface.test.ts` and moved
 * here when Matchmaking Analysis was raised to the same floor: the rule is a
 * property of these pages rather than of that one, and a second copy of the
 * scan would have been the third place to remember when the rule changes.
 * What stayed behind there is what is genuinely local to that page -- its
 * approved copy, its heading levels, its title case.
 *
 * Source text rather than a render, for the reason the original gave: this
 * has to hold for *every* line, not the handful a browser test samples.
 */
/**
 * Every file that renders part of each surface.
 *
 * The component directories are read rather than listed. A hand-kept list is
 * exactly one edit behind the feature it describes: this file shipped with
 * three of Matchmaking Analysis's nine components missing from it, all three
 * rendered on the page, and the existence check below cannot notice a file
 * that was never named. A directory scan cannot fall behind that way.
 *
 * `player-selector.tsx` is named explicitly because it belongs to neither
 * directory: LGA-100 put it inside the Games Comparison card, and a shared
 * control brings its own text sizes onto whatever page mounts it.
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

    // `text-xs` is the only *token* below 14px -- the scale is Tailwind's
    // default -- but an arbitrary value slips straight past a token ban, and
    // `text-[0.6875rem]` did exactly that on two surfaces in turn: 11px,
    // smaller than anything the ticket complained about, and green the whole
    // time. So arbitrary sizes are read and compared, not pattern-matched.
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
    // The scanned set is mostly derived, so this is aimed at what is not: a
    // page or a shared control that was moved or renamed would otherwise drop
    // out silently, and a rename is exactly when these regress. The count
    // guards the other direction -- a components directory that resolved to
    // nothing would pass every check below by scanning no source at all.
    for (const path of paths) {
      expect(() => readFileSync(path, "utf8"), path).not.toThrow();
    }
    expect(paths.length).toBeGreaterThan(2);
  });

  it("has no text under 14px left anywhere on it", () => {
    // LGA-101 exists because small muted copy is hard to read against this
    // background, and it asks for the whole page rather than the one example
    // it names. A browser test can only measure the nodes it thinks to
    // sample; this sees every line, including the ones a shared control
    // brings with it.
    expect(offendersIn(paths)).toEqual([]);
  });
});
