import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The parts of Rank Manipulation that a ticket fixed in writing.
 *
 * These are checked as source text rather than through a render because what
 * they pin is a decision, not a behaviour: a size floor that must hold for
 * *every* line rather than the two a browser test happens to sample, copy that
 * was approved word for word, and heading capitalisation that Playwright's
 * `getByRole({ name })` cannot pin because it matches case-insensitively.
 *
 * The counterpart e2e (`e2e/smurf-boost-detection.spec.ts`) measures the
 * rendered result. Neither replaces the other: this one is exhaustive and
 * blind to whether a class resolves, that one is exact and samples.
 */

/**
 * Every file that renders part of the page.
 *
 * `player-selector.tsx` is on the list because LGA-100 put it inside the
 * Games Comparison card. It is shared, so a violation there is not local to
 * this page -- which is the point: the size floor is a property of the
 * surface, and the surface now includes the search.
 */
const SURFACE_FILES = [
  "app/rank-manipulation/page.tsx",
  "features/players/components/player-selector.tsx",
  "features/smurf-boost/components/smurf-boost-detection.tsx",
  "features/smurf-boost/components/smurf-boost-explanation-card.tsx",
  "features/smurf-boost/components/smurf-boost-result-card.tsx",
  "features/smurf-boost/components/smurf-boost-settings-card.tsx",
  "features/smurf-boost/components/smurf-boost-settings-presets.tsx",
  "features/smurf-boost/components/smurf-boost-settings-thresholds.tsx",
];

/** JSX text as the browser lays it out: lines trimmed, joined by one space. */
function renderedText(source: string): string {
  return source
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
}

describe("the Rank Manipulation surface", () => {
  it("scans the files it is written against", () => {
    // A path that stopped existing would silently drop a file from every
    // check below, and a rename is exactly when these regress.
    for (const path of SURFACE_FILES) {
      expect(() => readFileSync(path, "utf8"), path).not.toThrow();
    }
  });

  it("has no 12px text left anywhere on it", () => {
    // LGA-101 exists because 12px muted copy is hard to read against this
    // background, and it asks for the whole page rather than the one example
    // it names. `text-xs` is the only way to reach 12px here -- the design
    // tokens are Tailwind's defaults. A browser test can only measure the
    // nodes it thinks to sample; this sees every line, including the ones a
    // shared control brings with it.
    const offenders = SURFACE_FILES.filter((path) =>
      /\btext-xs\b/.test(readFileSync(path, "utf8")),
    );

    expect(offenders).toEqual([]);
  });

  it("keeps the approved Games Comparison wording word for word", () => {
    // LGA-100 fixed this sentence exactly. Nothing else pins it: the e2e
    // asserts the card's title and that a search is inside it, never the copy.
    const source = readFileSync(
      "features/smurf-boost/components/smurf-boost-detection.tsx",
      "utf8",
    );

    expect(renderedText(source)).toContain(
      "Compare recent games with earlier games. This reads only ranked " +
        "solo/duo games already stored for this player. It contacts no " +
        "external service, so it finishes in one step.",
    );
  });

  it("keeps every card header in title case", () => {
    // Playwright matches an accessible name case-insensitively, so the e2e
    // passes on `Games comparison` just as happily. LGA-99 asked for one
    // convention across the page, and half of these headers were sentence
    // case until someone read them side by side.
    const headers: Array<[string, string]> = [
      [
        "features/smurf-boost/components/smurf-boost-explanation-card.tsx",
        "What This Page Does",
      ],
      [
        "features/smurf-boost/components/smurf-boost-settings-card.tsx",
        "Detection Settings",
      ],
      [
        "features/smurf-boost/components/smurf-boost-settings-presets.tsx",
        "Presets",
      ],
      [
        "features/smurf-boost/components/smurf-boost-settings-thresholds.tsx",
        "Thresholds",
      ],
      [
        "features/smurf-boost/components/smurf-boost-detection.tsx",
        "Games Comparison",
      ],
      [
        "features/smurf-boost/components/smurf-boost-result-card.tsx",
        "Comparison Result",
      ],
      [
        "features/smurf-boost/components/smurf-boost-result-card.tsx",
        "Limits of This Data",
      ],
    ];

    const missing = headers
      .filter(([path, header]) => !readFileSync(path, "utf8").includes(header))
      .map(([path, header]) => `${header} (${path})`);

    expect(missing).toEqual([]);
  });
});
