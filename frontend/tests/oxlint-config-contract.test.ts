// @vitest-environment node

import { describe, expect, it } from "vitest";

import packageJson from "../package.json";
import oxlintConfig from "../oxlint.config.mts";
import housePlugin from "../.oxlint-plugins/index.mts";
import {
  FEATURE_BARREL_IMPORTS,
  SESSION_TEARDOWN_IMPORTS,
} from "../.oxlint-plugins/restricted-imports.mts";
import {
  EDGE_ISOLATION_SYNTAX,
  SESSION_TEARDOWN_SYNTAX,
} from "../.oxlint-plugins/restricted-syntax.mts";

/**
 * An oxlint `overrides` entry replaces a rule's whole configuration rather than
 * merging, so a block that forgets the shared lists exempts its files.
 */

/**
 * The lists below are the oracle, duplicated from the config on purpose: a test
 * deriving its expectation from its subject checks spelling, not intent.
 */

/** Every group the shared import rule must ban, spelled out here on purpose. */
const EXPECTED_IMPORT_GROUPS = [
  "**/lib/session/token-manager*",
  "../session/token-manager*",
  "./session/token-manager*",
  "./token-manager*",
  "**/lib/session/auth-state-cookie*",
  "../session/auth-state-cookie*",
  "./session/auth-state-cookie*",
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
 * A count fails on a deletion without freezing the spelling of regexes that
 * get refined as new spellings of the same effect turn up.
 */
const EXPECTED_TEARDOWN_SELECTOR_COUNT = 11;
const EXPECTED_EDGE_SELECTOR_COUNT = 4;

/**
 * Blocks that set `no-restricted-imports` without the barrel list; a third one
 * must be argued.
 */
const EXPECTED_BARREL_EXEMPT_BLOCK_COUNT = 2;

/**
 * Every opt-out spelled out, so an added one has to be argued here first.
 */
const EXPECTED_EXEMPTIONS: Record<string, string[][]> = {
  "house/session-teardown-syntax": [
    ["tests/**", "e2e/**"],
    [
      "lib/session/auth-state-cookie.ts",
      "features/cookie-consent/consent-storage.ts",
    ],
  ],
  "no-restricted-imports": [
    ["lib/session/token-manager.ts", "features/auth/context/auth-context.tsx"],
    [".oxlint-plugins/**"],
  ],
  // Both path scanners skip `tests/` and `e2e/`; anywhere else a request built
  // from a variable leaves their coverage without saying so.
  "house/require-literal-api-path": [["tests/**", "e2e/**"]],
};

/**
 * A floor under the extraction below, not a census: it only has to prove the
 * walk found rules before the comparison calls them all present.
 */
const MINIMUM_HOUSE_RULES = 10;

type Override = {
  files?: string[];
  excludeFiles?: string[];
  rules?: Record<string, unknown>;
};
type Pattern = { group?: string[]; allowImportNames?: string[] };

const overrides = (oxlintConfig.overrides ?? []) as Override[];

/**
 * Blocks whose value is an array, i.e. a severity plus options; an `"off"`
 * string is an exemption and is checked by name below rather than skipped.
 */
const blocksSetting = (rule: string): Override[] =>
  overrides.filter((block) => Array.isArray(block.rules?.[rule]));

const blocksTurningOff = (rule: string): Override[] =>
  overrides.filter((block) => block.rules?.[rule] === "off");

/** Every setting the config gives each `house/<rule>`, top level and overrides. */
const houseRuleSettings = (prefix: string): Map<string, unknown[]> => {
  const settings = new Map<string, unknown[]>();
  const blocks = [
    (oxlintConfig.rules ?? {}) as Record<string, unknown>,
    ...overrides.map((block) => block.rules ?? {}),
  ];
  for (const rules of blocks) {
    for (const [rule, setting] of Object.entries(rules)) {
      if (!rule.startsWith(prefix)) continue;
      settings.set(rule, [...(settings.get(rule) ?? []), setting]);
    }
  }
  return settings;
};

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
        // The allowlist itself, not just the paths: a block with the right
        // patterns but an extra allowed name looks identical and permits it.
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
    // The four effects, whatever their spelling, so a refined regex still has
    // to cover each one.
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
    // An exclusion wider than the named ones silently stops the guard applying
    // to the code it exists for.
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
    // absent rather than an error.
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

  it("names every house rule the plugin registers, and registers every one it names", () => {
    // Against `index.mts`, the other half of the pair: oxlint neither fails on
    // a rule name it cannot resolve nor on a registered rule nobody enables.
    const prefix = `${housePlugin.meta.name}/`;
    const registered = Object.keys(housePlugin.rules);
    const named = houseRuleSettings(prefix);
    expect(registered.length).toBeGreaterThanOrEqual(MINIMUM_HOUSE_RULES);
    expect(named.size).toBeGreaterThanOrEqual(MINIMUM_HOUSE_RULES);

    expect([...named.keys()].sort()).toEqual(
      registered.map((rule) => `${prefix}${rule}`).sort(),
    );
    for (const [rule, settings] of named) {
      const enabled = settings.some(
        (setting) =>
          setting === "error" ||
          (Array.isArray(setting) && setting[0] === "error"),
      );
      expect(enabled, `${rule} is turned off everywhere it is named`).toBe(true);
    }
  });

  it("runs the session guards on application code at all", () => {
    // Existence, not scope: a config that enables neither rule reports nothing
    // and still passes every scope check above.
    expect(oxlintConfig.rules?.["house/session-teardown-syntax"]).toBe("error");
    expect(oxlintConfig.jsPlugins).toContain("./.oxlint-plugins/index.mts");

    const edgeBlock = overrides.find(
      (block) => block.rules?.["house/edge-isolation-syntax"] === "error",
    );
    expect(edgeBlock?.files).toContain("proxy.ts");
    // Next takes the LAST discovery match, so a `proxy.tsx` or `middleware.ts`
    // beside `proxy.ts` silently becomes the edge.
    expect(edgeBlock?.files).toContain("proxy.tsx");
    expect(edgeBlock?.files).toContain("middleware.ts");
  });
});
