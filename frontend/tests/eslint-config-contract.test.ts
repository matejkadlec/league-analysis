// @vitest-environment node

import { describe, expect, it } from "vitest";

import eslintConfig, {
  sessionTeardownImports,
  sessionTeardownSyntax,
} from "../eslint.config.mjs";

/**
 * A flat-config block replaces a rule's options; it does not merge them.
 *
 * That has now cost this design twice. Round 15 scoped a
 * `no-restricted-imports` block to `proxy.ts` and silently turned the file the
 * whole edge guard is about into the only one allowed to import the teardown
 * helpers. Round 18 did the same to route handlers. Both times lint stayed
 * green, because a rule that is not applied reports nothing -- the quietest
 * kind of hole there is.
 *
 * So the shared list is a contract: any block that sets these rules carries
 * them. This reads the exported config rather than the file's text, so a
 * block added tomorrow in any shape is checked the same way.
 *
 * Carrying the list is necessary and not sufficient, which is the second
 * lesson here. An audit neutered every one of these rules four ways while
 * this file stayed green: flipping each severity to `"off"` (the lists sat
 * untouched, and `Array.isArray(["off", ...])` is true); deleting a selector
 * from the shared list (the test imported that list and compared it to
 * itself); widening the exemption blocks to `**` (a block whose value is the
 * string `"off"` was never even collected); and adding `components/**` to an
 * `ignores`. Each shipped with eslint, tsc and all 333 tests green, and each
 * silently removed the whole session-teardown guard.
 *
 * So the literals below are the oracle, deliberately duplicated from the
 * config. A test that derives its expectation from its subject checks
 * spelling, not intent.
 */

/** Every group the shared import rule must ban, spelled out here on purpose. */
const EXPECTED_IMPORT_GROUPS = [
  "**/auth/utils/token-manager*",
  "../utils/token-manager*",
  "./utils/token-manager*",
  "./token-manager*",
  "**/auth/utils/auth-state-cookie*",
  "../utils/auth-state-cookie*",
  "./utils/auth-state-cookie*",
  "./auth-state-cookie*",
];

/** The names each of those groups may still import. */
const EXPECTED_ALLOWED_NAMES = [
  ["refreshAccessToken"],
  [
    "AUTH_STATE_COOKIE_NAME",
    "AUTH_STATE_COOKIE_VALUE",
    "hasAuthStateCookie",
    "subscribeToAuthStateCookie",
  ],
];

/**
 * How many selectors the shared syntax list holds. A count is a blunt oracle
 * and deliberately so: it fails on a deletion without freezing the spelling
 * of eleven regexes, which get refined as new spellings of the same effect
 * turn up.
 */
const EXPECTED_SELECTOR_COUNT = 11;

/** The files allowed to opt out, and the rule each opts out of. */
const EXPECTED_EXEMPTIONS: Record<string, string[]> = {
  "no-restricted-syntax": [
    "features/auth/utils/auth-state-cookie.ts",
    "features/cookie-consent/utils/consent-storage.ts",
  ],
  "no-restricted-imports": [
    "features/auth/utils/token-manager.ts",
    "features/auth/context/auth-context.tsx",
  ],
};
type Block = {
  files?: unknown;
  ignores?: unknown;
  rules?: Record<string, unknown>;
};

function blocksSetting(rule: string): Block[] {
  return (eslintConfig as Block[]).filter((block) => {
    const value = block.rules?.[rule];
    // `"off"` is a deliberate exemption for the files that own cookie writes.
    // Those blocks are checked by name below rather than skipped: an audit
    // widened one of them to `**/*.{ts,tsx}` and nothing here noticed.
    return Array.isArray(value);
  });
}

function blocksTurningOff(rule: string): Block[] {
  return (eslintConfig as Block[]).filter(
    (block) => block.rules?.[rule] === "off",
  );
}

describe("the eslint config's shared teardown rules", () => {
  it("is applied by every block that sets no-restricted-imports", () => {
    const blocks = blocksSetting("no-restricted-imports");
    expect(blocks.length).toBeGreaterThan(1);

    for (const block of blocks) {
      const [severity, options] = block.rules?.["no-restricted-imports"] as [
        string,
        { patterns?: { group?: string[]; allowImportNames?: string[] }[] },
      ];
      // A rule that is not applied reports nothing, and the list it carries
      // looks perfect from here.
      expect(severity, `block for ${JSON.stringify(block.files)}`).toBe(
        "error",
      );
      const groups = (options.patterns ?? []).flatMap(
        (pattern) => pattern.group ?? [],
      );
      for (const shared of sessionTeardownImports) {
        for (const pattern of shared.group ?? []) {
          expect(groups, `block for ${JSON.stringify(block.files)}`).toContain(
            pattern,
          );
        }
        // The allowlist itself, not just the paths it applies to: a block
        // carrying the right patterns with `clearAuthStateCookie` added to
        // the allowed names permits the teardown import while looking
        // identical from the outside.
        const applied = (options.patterns ?? []).find((pattern) =>
          (pattern.group ?? []).some((entry) =>
            (shared.group ?? []).includes(entry),
          ),
        );
        expect(
          applied?.allowImportNames,
          `block for ${JSON.stringify(block.files)}`,
        ).toEqual(shared.allowImportNames);
      }
    }
  });

  it("is applied by every block that sets no-restricted-syntax", () => {
    const blocks = blocksSetting("no-restricted-syntax");
    expect(blocks.length).toBeGreaterThan(1);

    for (const block of blocks) {
      const [severity, ...rules] = block.rules?.["no-restricted-syntax"] as [
        string,
        ...{ selector: string }[],
      ];
      expect(severity, `block for ${JSON.stringify(block.files)}`).toBe(
        "error",
      );
      const selectors = rules.map((rule) => rule.selector);
      // Every shared selector, not a sample of one: a block carrying the
      // hint-name selector while dropping the `document.cookie`, `Set-Cookie`
      // and `Clear-Site-Data` ones would have passed a spot check.
      for (const shared of sessionTeardownSyntax) {
        expect(selectors, `block for ${JSON.stringify(block.files)}`).toContain(
          shared.selector,
        );
      }
    }
  });

  it("bans the modules and names it is supposed to ban", () => {
    // Against literals, not against itself. Deleting a group or adding a name
    // to an allowlist changes the shared list, and every block still "carries
    // the shared list" afterwards -- so the comparison has to come from
    // outside the config.
    expect(
      sessionTeardownImports.flatMap((pattern) => pattern.group ?? []),
    ).toEqual(EXPECTED_IMPORT_GROUPS);
    expect(
      sessionTeardownImports.map((pattern) => pattern.allowImportNames),
    ).toEqual(EXPECTED_ALLOWED_NAMES);
  });

  it("keeps every selector it is supposed to keep", () => {
    const selectors = sessionTeardownSyntax.map((rule) => rule.selector);
    // The four effects, whatever their spelling: a cookie written by hand, a
    // Set-Cookie or Clear-Site-Data header, and the hint's own name appearing
    // where something is being deleted.
    expect(selectors.length).toBe(EXPECTED_SELECTOR_COUNT);
    expect(
      selectors.some((selector) => selector.includes("property.name='cookie'")),
    ).toBe(true);
    expect(
      selectors.some((selector) => selector.toLowerCase().includes("set-cookie")),
    ).toBe(true);
    expect(
      selectors.some((selector) =>
        selector.toLowerCase().includes("clear-site-data"),
      ),
    ).toBe(true);
  });

  it("lets only the owning files opt out", () => {
    // An exemption is a decision about two named files. Widened to `**` it is
    // the absence of the rule, and reads in a diff as a scope change.
    for (const [rule, expected] of Object.entries(EXPECTED_EXEMPTIONS)) {
      const blocks = blocksTurningOff(rule);
      expect(blocks.length, rule).toBe(1);
      expect(blocks[0]?.files, rule).toEqual(expected);
    }
  });

  it("never ignores application code", () => {
    // `tests/` and `e2e/` are the only directories these rules skip, plus the
    // five pages that read the hint. An audit added `components/**` to an
    // ignore list and the whole guard stopped applying to the components it
    // exists for.
    // Only the blocks carrying these rules; the Next preset ignores build
    // output, which is none of this test's business.
    const ignoreLists = (eslintConfig as Block[])
      .filter(
        (block) =>
          Array.isArray(block.ignores) &&
          (block.rules?.["no-restricted-imports"] !== undefined ||
            block.rules?.["no-restricted-syntax"] !== undefined),
      )
      .map((block) => block.ignores as string[]);
    expect(ignoreLists.length).toBeGreaterThan(0);

    for (const list of ignoreLists) {
      for (const entry of list) {
        expect(
          entry === "tests/**" ||
            entry === "e2e/**" ||
            entry.startsWith("app/"),
          `ignore entry ${entry}`,
        ).toBe(true);
      }
    }
  });
});
