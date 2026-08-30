import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The heading outline of Rank Manipulation, checked as source text because it
 * spans files no single render covers and axe's `heading-order` is outside the
 * tag set the e2e scan runs. The counterpart e2e measures the rendered result.
 */

/**
 * Every file that renders part of the page. `player-selector.tsx` is on the
 * list because LGA-100 put it inside the Games Comparison card.
 */
const SURFACE_FILES = [
  "app/rank-manipulation/page.tsx",
  "features/players/components/player-selector.tsx",
  "features/smurf-boost/components/smurf-boost-detection.tsx",
  "features/smurf-boost/components/smurf-boost-explanation-card.tsx",
  "features/smurf-boost/components/smurf-boost-result-card.tsx",
  "features/smurf-boost/components/smurf-boost-settings-dialog.tsx",
  "features/smurf-boost/components/smurf-boost-settings-presets.tsx",
  "features/smurf-boost/components/smurf-boost-settings-thresholds.tsx",
];

describe("the Rank Manipulation surface", () => {
  it("scans the files it is written against", () => {
    // A path that stopped existing would silently drop a file from every
    // check below, and a rename is exactly when these regress.
    for (const path of SURFACE_FILES) {
      expect(() => readFileSync(path, "utf8"), path).not.toThrow();
    }
  });

  it("keeps every heading below the card title that holds it", () => {
    // `CardTitle` renders an `h3`, so a subsection inside a card is an `h4`.
    // axe's `heading-order` is best-practice and not in the tag set the e2e scan
    // runs, so nothing else catches an outline that reads h1, h3, h2.

    // The settings components render inside a dialog whose `DialogTitle` is an
    // `h2`, so their headings floor at `h3`; an `h4` would skip a level.
    const DIALOG_FILES = new Set([
      "features/smurf-boost/components/smurf-boost-settings-dialog.tsx",
      "features/smurf-boost/components/smurf-boost-settings-presets.tsx",
      "features/smurf-boost/components/smurf-boost-settings-thresholds.tsx",
    ]);
    const offenders: string[] = [];

    for (const path of SURFACE_FILES) {
      const floor = DIALOG_FILES.has(path) ? 3 : 4;
      for (const [, level] of readFileSync(path, "utf8").matchAll(
        /<h([1-6])[\s>]/g,
      )) {
        if (Number(level) < floor) {
          offenders.push(`${path}: h${level}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
