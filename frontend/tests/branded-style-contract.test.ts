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

  /**
   * `globals.css` paints `#header-card` with `background: ... !important`, in
   * both themes. A `bg-*` utility on that element therefore renders nothing --
   * measured in Chrome, where the utility's own `background-color` computes to
   * `rgba(0, 0, 0, 0)` because the winning shorthand resets it. Three pages
   * carried `bg-[#152b56] ... dark:bg-[#0a1428]`, a hand-copied pair of the
   * hexes the stylesheet already owns, doing nothing on any of them.
   */
  it("leaves the header card's background to the stylesheet that owns it", () => {
    const background =
      /\bdark:bg-\[|\bbg-\[|\bbg-(?:navy|card|background|primary)\b/;
    const headerCards = allSourceFiles().filter((path) =>
      code(path).includes('id="header-card"'),
    );
    // Signal first: a scan that stopped finding header cards would pass by
    // finding nothing wrong with them. Every primary page now renders the
    // card through components/page-header.tsx, but two surfaces still spell
    // it themselves because their title is a different thing -- the home
    // hero and the legal shell both use the League display font at their own
    // size in a `py-2` card, which the shared header would have to grow
    // knobs for. Pin all three, so converting one of them has to come here.
    expect(
      headerCards.map((path) => relative(process.cwd(), path)).sort(),
    ).toEqual([
      "app/page.tsx",
      "components/legal-page-shell.tsx",
      "components/page-header.tsx",
    ]);

    const offenders = headerCards
      .filter((path) => {
        const source = code(path);
        const header = source.indexOf('id="header-card"');
        const openingTag = source.slice(
          Math.max(0, header - 400),
          header + 400,
        );
        return background.test(openingTag);
      })
      .map((path) => relative(process.cwd(), path));

    expect(offenders).toEqual([]);
  });

  /**
   * The branded classes are defined under `.dark` and nowhere else, so the
   * document has to carry that class unconditionally or they style nothing.
   *
   * It used to be chosen at runtime -- `defaultTheme="system" enableSystem`,
   * with no toggle in the UI -- so a viewer whose OS was set to light got
   * white shadcn cards on the dark League splash `#content` paints
   * unconditionally, and grey buttons where the gold, red and blue gradients
   * belong. Nothing failed: the classes were all still present in the
   * stylesheet, which is all the rule above checks.
   */
  it("forces the theme the branded classes are written for", () => {
    const stylesheet = readFileSync(GLOBAL_STYLESHEET, "utf8");
    // Signal first: if a branded class ever gains an unscoped definition this
    // coupling is no longer load-bearing, and the assertion below is checking
    // a convention rather than a contract.
    const darkOnly = BRANDED_CLASSES.filter(
      (name) =>
        stylesheet.includes(`.dark .${name}`) &&
        !new RegExp(`^\\s*\\.${name}\\b`, "m").test(stylesheet),
    );
    expect(darkOnly.length).toBeGreaterThanOrEqual(3);

    // Native widgets read `color-scheme` and nothing else, and next-themes
    // used to set it on the element for us. Nothing in the gate renders UA
    // chrome, so a light scrollbar on a #00091a page fails no other check.
    expect(stylesheet).toMatch(/^\s*color-scheme:\s*dark;/m);

    const layout = readFileSync("app/layout.tsx", "utf8");
    expect(layout).toMatch(/<html[^>]*className="dark"/);
    expect(
      layout.includes("next-themes"),
      "the theme is picked at runtime again, which light viewers cannot survive",
    ).toBe(false);
  });

  /**
   * A class from a plugin that is not installed styles nothing.
   *
   * `app/page.tsx` and `components/legal-page-shell.tsx` both carried
   * `prose prose-lg`, and `.claude/IMPROVEMENTS.md` carried an open question
   * about whether that typography was overriding the card's text colour. It
   * was not overriding anything: `@tailwindcss/typography` is not a
   * dependency and no `@plugin` line registers it, so both were inert names
   * that read as deliberate styling to everyone who saw them.
   *
   * Either half is fine on its own. Using the classes without the plugin is
   * what is not.
   */
  it("does not use plugin classes the build cannot generate", () => {
    const manifest = readFileSync("package.json", "utf8");
    const stylesheet = readFileSync(GLOBAL_STYLESHEET, "utf8");
    const installed =
      manifest.includes('"@tailwindcss/typography"') &&
      stylesheet.includes('@plugin "@tailwindcss/typography"');
    if (installed) return;

    const users = allSourceFiles()
      .filter((path) => /class(Name)?="[^"]*\bprose\b/.test(code(path)))
      .map((path) => relative(process.cwd(), path));

    expect(users).toEqual([]);
  });

  it("keeps the hand-rolled list free of dead entries", () => {
    const using = new Set(filesWithHandRolledGradients());
    const stale = [...HAND_ROLLED_GRADIENTS.keys()].filter(
      (path) => !using.has(path),
    );

    expect(stale).toEqual([]);
  });
});
