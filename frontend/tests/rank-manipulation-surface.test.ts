import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The parts of Rank Manipulation that a ticket fixed in writing.
 *
 * These are checked as source text rather than through a render because what
 * they pin is a decision, not a behaviour: copy that was approved word for
 * word, and heading capitalisation that Playwright's `getByRole({ name })`
 * cannot pin because it matches case-insensitively. LGA-101's size floor left
 * for `text-size-floor.test.ts` once a second surface was held to it.
 *
 * The counterpart e2e (`e2e/smurf-boost-detection.spec.ts`) measures the
 * rendered result. Neither replaces the other: this one is exhaustive and
 * blind to whether a class resolves, that one is exact and samples.
 */

/**
 * Every file that renders part of the page.
 *
 * `player-selector.tsx` is on the list because LGA-100 put it inside the
 * Games Comparison card, and a heading or a stray `text-xs` there lands on
 * this page like any other.
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

  it("keeps every heading below the card title that holds it", () => {
    // `CardTitle` renders an `h3`, so a subsection inside a card is an `h4`.
    // The result card had its two family headings as `h2` -- an outline that
    // read h1, h3, h2 and put the page's only `h2`s underneath an `h3`.
    // Nothing caught it: axe's `heading-order` is a best-practice rule and is
    // not in the tag set the e2e scan runs.
    const offenders: string[] = [];

    for (const path of SURFACE_FILES) {
      for (const [, level] of readFileSync(path, "utf8").matchAll(
        /<h([1-6])[\s>]/g,
      )) {
        if (Number(level) < 4) {
          offenders.push(`${path}: h${level}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("keeps the approved Games Comparison wording word for word", () => {
    // LGA-100 fixed this sentence exactly. Nothing else pins it: the e2e
    // asserts the card's title and that a search is inside it, never the copy.
    //
    // Rewritten when the run button started fetching from Riot: the approved
    // sentence promised the opposite ("contacts no external service"), and a
    // pinned sentence that has become false is worse than no pin at all.
    const source = readFileSync(
      "features/smurf-boost/components/smurf-boost-detection.tsx",
      "utf8",
    );

    expect(renderedText(source)).toContain(
      "Compare recent games with earlier games, using ranked solo/duo " +
        "games only. Running it fetches this player&apos;s newest games " +
        "from Riot first, so the comparison reads current history rather " +
        "than waiting for the next scheduled update.",
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
