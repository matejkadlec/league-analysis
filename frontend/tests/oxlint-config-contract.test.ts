// @vitest-environment node

import { describe, expect, it } from "vitest";

import packageJson from "../package.json";
import oxlintConfig from "../oxlint.config.mts";
import {
  FEATURE_BARREL_IMPORTS,
  SESSION_TEARDOWN_IMPORTS,
} from "../.oxlint-plugins/restricted-imports.mts";
import {
  EDGE_ISOLATION_SYNTAX,
  SESSION_TEARDOWN_SYNTAX,
} from "../.oxlint-plugins/restricted-syntax.mts";

/**
 * An oxlint `overrides` entry replaces a rule's whole configuration for the
 * files it matches; it does not merge. A block that sets
 * `no-restricted-imports` and forgets the shared lists exempts that file.
 */

/**
 * The lists below are the oracle, deliberately duplicated from the config: a
 * test that derives its expectation from its subject checks spelling, not
 * intent.
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

const EXPECTED_BARREL_GROUPS = ["@/features/*/*", "@/features/*/*/**"];

/**
 * A count is a blunt oracle and deliberately so: it fails on a deletion
 * without freezing the spelling of regexes that get refined as new spellings
 * of the same effect turn up.
 */
const EXPECTED_TEARDOWN_SELECTOR_COUNT = 11;
const EXPECTED_EDGE_SELECTOR_COUNT = 4;

/**
 * Blocks that set `no-restricted-imports` without the barrel list, each a
 * named decision: the API client's one documented deep import, the five
 * hint-reading pages, and the edge's own allowlist. A fourth must be argued.
 */
const EXPECTED_BARREL_EXEMPT_BLOCK_COUNT = 3;

/**
 * Every opt-out, spelled out: the two directories that build the scenarios
 * they assert on, the two files that own cookie writes, the two that own the
 * refused-versus-unreachable distinction, and the plugin sources.
 */
const EXPECTED_EXEMPTIONS: Record<string, string[][]> = {
  "house/session-teardown-syntax": [
    ["tests/**", "e2e/**"],
    [
      "features/auth/utils/auth-state-cookie.ts",
      "features/cookie-consent/utils/consent-storage.ts",
    ],
  ],
  "no-restricted-imports": [
    [
      "features/auth/utils/token-manager.ts",
      "features/auth/context/auth-context.tsx",
    ],
    [".oxlint-plugins/**"],
  ],
};

type Override = {
  files?: string[];
  excludeFiles?: string[];
  rules?: Record<string, unknown>;
};
type Pattern = { group?: string[]; allowImportNames?: string[] };

const overrides = (oxlintConfig.overrides ?? []) as Override[];

/**
 * Blocks whose value is an array, i.e. a severity plus options. A `"off"`
 * string is a deliberate exemption and is checked by name below rather than
 * skipped: an audit widened one of those to `**` and nothing noticed.
 */
const blocksSetting = (rule: string): Override[] =>
  overrides.filter((block) => Array.isArray(block.rules?.[rule]));

const blocksTurningOff = (rule: string): Override[] =>
  overrides.filter((block) => block.rules?.[rule] === "off");

const optionsOf = (block: Override, rule: string) =>
  block.rules?.[rule] as [string, { patterns?: Pattern[] }];

describe("the oxlint config's shared teardown rules", () => {
  it("is applied by every block that sets no-restricted-imports", () => {
    const blocks = blocksSetting("no-restricted-imports");
    expect(blocks.length).toBeGreaterThan(1);

    for (const block of blocks) {
      const label = `block for ${JSON.stringify(block.files)}`;
      const [severity, options] = optionsOf(block, "no-restricted-imports");
      expect(severity, label).toBe("error");

      const groups = (options.patterns ?? []).flatMap(
        (pattern) => pattern.group ?? [],
      );
      for (const shared of SESSION_TEARDOWN_IMPORTS) {
        for (const pattern of shared.group) {
          expect(groups, label).toContain(pattern);
        }
        // The allowlist itself, not just the paths it applies to: a block
        // carrying the right patterns with `clearAuthStateCookie` added to
        // the allowed names permits the teardown while looking identical.
        const applied = (options.patterns ?? []).find((pattern) =>
          (pattern.group ?? []).some((entry) => shared.group.includes(entry)),
        );
        expect(applied?.allowImportNames, label).toEqual(
          shared.allowImportNames,
        );
      }
    }
  });

  it("bans the modules and names it is supposed to ban", () => {
    // Against literals, not against itself: deleting a group changes the
    // shared list, and every block still "carries the shared list" after.
    expect(SESSION_TEARDOWN_IMPORTS.flatMap((p) => p.group)).toEqual(
      EXPECTED_IMPORT_GROUPS,
    );
    expect(SESSION_TEARDOWN_IMPORTS.map((p) => p.allowImportNames)).toEqual(
      EXPECTED_ALLOWED_NAMES,
    );
  });

  it("carries the barrel list in every general no-restricted-imports block", () => {
    expect(FEATURE_BARREL_IMPORTS.flatMap((p) => p.group)).toEqual(
      EXPECTED_BARREL_GROUPS,
    );

    const blocks = blocksSetting("no-restricted-imports");
    const carrying = blocks.filter((block) =>
      (optionsOf(block, "no-restricted-imports")[1].patterns ?? []).some(
        (pattern) => (pattern.group ?? []).includes("@/features/*/*"),
      ),
    );
    expect(carrying.length).toBe(
      blocks.length - EXPECTED_BARREL_EXEMPT_BLOCK_COUNT,
    );
  });

  it("keeps every selector it is supposed to keep", () => {
    const teardown = SESSION_TEARDOWN_SYNTAX.map((rule) => rule.selector);
    expect(teardown.length).toBe(EXPECTED_TEARDOWN_SELECTOR_COUNT);
    // The four effects, whatever their spelling: a cookie written by hand, a
    // Set-Cookie or Clear-Site-Data header, and the hint's own name appearing
    // where something is being deleted.
    expect(
      teardown.some((selector) => selector.includes("property.name='cookie'")),
    ).toBe(true);
    expect(
      teardown.some((s) => s.toLowerCase().includes("set-cookie")),
    ).toBe(true);
    expect(
      teardown.some((s) => s.toLowerCase().includes("clear-site-data")),
    ).toBe(true);
    expect(
      teardown.some((s) => s.includes("AUTH_STATE_COOKIE_NAME")),
    ).toBe(true);

    const edge = EDGE_ISOLATION_SYNTAX.map((rule) => rule.selector);
    expect(edge.length).toBe(EXPECTED_EDGE_SELECTOR_COUNT);
    // Static import, dynamic import, re-export, member `fetch` -- an audit
    // walked past an earlier version through each of the last three.
    expect(edge.some((s) => s.startsWith("ImportDeclaration"))).toBe(true);
    expect(edge).toContain("ImportExpression");
    expect(edge.some((s) => s.includes("ExportAllDeclaration"))).toBe(true);
    expect(edge.some((s) => s.includes("property.name='fetch'"))).toBe(true);
  });

  it("lets only the owning files opt out", () => {
    // An exemption is a decision about two named files. Widened to `**` it is
    // the absence of the rule, and reads in a diff as a scope change.
    for (const [rule, expected] of Object.entries(EXPECTED_EXEMPTIONS)) {
      const blocks = blocksTurningOff(rule);
      expect(
        blocks.map((block) => block.files),
        rule,
      ).toEqual(expected);
    }
  });

  it("never excludes application code from the session guards", () => {
    // `tests/` and `e2e/` are the only directories these rules skip, plus the
    // five hint-reading pages and the plugin sources. Anything wider silently
    // stops the guard applying to the code it exists for.
    const guarded = new Set([
      "no-restricted-imports",
      "house/session-teardown-syntax",
    ]);
    const exclusionLists = overrides
      .filter((block) =>
        Object.keys(block.rules ?? {}).some((rule) => guarded.has(rule)),
      )
      .map((block) => block.excludeFiles ?? []);
    expect(exclusionLists.length).toBeGreaterThan(0);

    for (const list of exclusionLists) {
      for (const entry of list) {
        expect(
          entry === "tests/**" || entry === "e2e/**" || entry.startsWith("app/"),
          `exclusion entry ${entry}`,
        ).toBe(true);
      }
    }
  });

  it("keeps the flags the config's rules are inert without", () => {
    // Neither flag is expressible in the config file, and both buy silence when
    // absent: a type-aware rule without `--type-aware` reports nothing, and a
    // regressed fixture passes on its now-pointless suppression.
    const lint = (packageJson as { scripts: Record<string, string> }).scripts
      .lint;
    expect(lint).toContain("--type-aware");
    expect(lint).toContain(
      "--report-unused-disable-directives-severity=error",
    );
    expect(lint).toContain("oxlint.config.mts");

    const rules = oxlintConfig.rules as Record<string, unknown>;
    expect(rules["typescript/no-floating-promises"]).toBe("error");
    expect(rules["typescript/no-misused-promises"]).toBe("error");
  });

  it("runs the session guards on application code at all", () => {
    // The rules above are all about scope. This one is about existence: a
    // config that enables neither reports nothing and passes every check
    // above, because every list it fails to carry is a list it never sets.
    expect(oxlintConfig.rules?.["house/session-teardown-syntax"]).toBe("error");
    expect(oxlintConfig.jsPlugins).toContain("./.oxlint-plugins/index.mts");

    const edgeBlock = overrides.find(
      (block) => block.rules?.["house/edge-isolation-syntax"] === "error",
    );
    expect(edgeBlock?.files).toContain("proxy.ts");
    // Next takes the LAST discovery match, so a `proxy.tsx` beside `proxy.ts`
    // silently becomes the edge -- and `middleware.*` is the name Next also
    // accepts, which an audit used to put the probe outside every rule.
    expect(edgeBlock?.files).toContain("proxy.tsx");
    expect(edgeBlock?.files).toContain("middleware.ts");
  });
});
