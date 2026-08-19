// @vitest-environment node

import { describe, expect, it } from "vitest";

import eslintConfig from "../eslint.config.mjs";

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
 */
type Block = {
  files?: unknown;
  rules?: Record<string, unknown>;
};

function blocksSetting(rule: string): Block[] {
  return (eslintConfig as Block[]).filter((block) => {
    const value = block.rules?.[rule];
    // `"off"` is a deliberate exemption for the two files that own cookie
    // writes, and it is visible in the config as such.
    return Array.isArray(value);
  });
}

describe("the eslint config's shared teardown rules", () => {
  it("is applied by every block that sets no-restricted-imports", () => {
    const blocks = blocksSetting("no-restricted-imports");
    expect(blocks.length).toBeGreaterThan(1);

    for (const block of blocks) {
      const [, options] = block.rules?.["no-restricted-imports"] as [
        string,
        { patterns?: { group?: string[] }[] },
      ];
      const groups = (options.patterns ?? []).flatMap(
        (pattern) => pattern.group ?? [],
      );
      expect(groups, `block for ${JSON.stringify(block.files)}`).toContain(
        "**/auth/utils/token-manager*",
      );
      expect(groups, `block for ${JSON.stringify(block.files)}`).toContain(
        "**/auth/utils/auth-state-cookie*",
      );
    }
  });

  it("is applied by every block that sets no-restricted-syntax", () => {
    const blocks = blocksSetting("no-restricted-syntax");
    expect(blocks.length).toBeGreaterThan(1);

    for (const block of blocks) {
      const [, ...rules] = block.rules?.["no-restricted-syntax"] as [
        string,
        ...{ selector: string }[],
      ];
      const selectors = rules.map((rule) => rule.selector);
      expect(selectors, `block for ${JSON.stringify(block.files)}`).toContain(
        "CallExpression[callee.property.name=/^(set|delete)$/] Identifier[name='AUTH_STATE_COOKIE_NAME']",
      );
    }
  });
});
