import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";

import { allSourceFiles } from "./source-scan-support";

const GLOBAL_STYLESHEET = "app/globals.css";

/**
 * The branded classes that carry a product decision about what an element
 * means: primary, destructive, neutral, and the shared dialog/icon shapes.
 * Each must keep existing in `globals.css` — renaming one without updating
 * its callers leaves them styled by nothing at all, which typechecks, lints,
 * and renders as an unstyled element.
 */
const BRANDED_CLASSES = [
  "gold-gradient",
  "red-gradient",
  "blue-gradient",
  "icon-circle",
  "dialog-white-border",
];

/**
 * Every file allowed to hand-roll a gradient, and why it is not a branded
 * surface. A gradient outside this list is the failure the branded classes
 * exist to prevent: an action styled to look primary or destructive by
 * inline Tailwind, which then drifts from the real ones on the next change.
 */
const HAND_ROLLED_GRADIENTS = new Map([
  ["components/ui/skeleton.tsx", "shadcn primitive's loading shimmer sweep"],
  [
    "features/matches/components/match-row.tsx",
    "a separator that fades out at both ends, not a surface",
  ],
  [
    "features/profile/components/recent-performance-card.tsx",
    "a separator that fades out at both ends, not a surface",
  ],
  [
    "features/players/utils/rank-colors.ts",
    "Riot's own Challenger rank colours, which are a gradient by definition",
  ],
]);

/** Source with comments removed, so prose about a gradient is not a use. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*/g, "");
}

function filesWithHandRolledGradients(): string[] {
  // Tailwind v3 spells it bg-gradient-to-*, v4 bg-linear-to-*; accept both so
  // the check survives the upgrade rather than silently matching nothing.
  const gradient = /\bbg-(?:gradient|linear)-to-[trbl]\b/;
  return allSourceFiles()
    .filter((path) => gradient.test(code(path)))
    .map((path) => relative(process.cwd(), path));
}

describe("branded style contract", () => {
  it("keeps every branded class defined in the global stylesheet", () => {
    const stylesheet = readFileSync(GLOBAL_STYLESHEET, "utf8");
    const undefinedClasses = BRANDED_CLASSES.filter(
      (name) => !stylesheet.includes(`.${name}`),
    );

    expect(undefinedClasses).toEqual([]);
  });

  it("hand-rolls a gradient only where the file says why", () => {
    const unjustified = filesWithHandRolledGradients().filter(
      (path) => !HAND_ROLLED_GRADIENTS.has(path),
    );

    expect(unjustified).toEqual([]);
  });

  it("keeps the hand-rolled list free of dead entries", () => {
    const using = new Set(filesWithHandRolledGradients());
    const stale = [...HAND_ROLLED_GRADIENTS.keys()].filter(
      (path) => !using.has(path),
    );

    expect(stale).toEqual([]);
  });
});
