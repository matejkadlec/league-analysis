import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";

import { allSourceFiles } from "./support/source-scan-support";

/**
 * Player freshness is `*_synced_at`, the timestamp of the provider check that
 * sourced the field. `updated_at` moves when anything on the row changes, so a
 * card using it claims freshness an unrelated column earned.
 */
const NON_FRESHNESS_UPDATED_AT = new Map<string, string>([
  // The schema modules declare the wire shape; none of them display anything.
  ...(
    [
      "lib/core/schemas/account.ts",
      "lib/core/schemas/jobs.ts",
      "lib/core/schemas/match.ts",
      "lib/core/schemas/player.ts",
      "lib/core/schemas/settings.ts",
    ] as const
  ).map(
    (path) =>
      [path, "declares the wire shape, does not display it"] as const,
  ),
  [
    "features/settings/components/riot-api-settings-card.tsx",
    "when a setting itself was last changed",
  ],
]);

/** Source with comments removed, so prose about `updated_at` is not a use. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*/g, "");
}

function filesUsingUpdatedAt(): string[] {
  return allSourceFiles()
    .filter((path) => /\bupdated_at\b/.test(code(path)))
    .map((path) => relative(process.cwd(), path));
}

describe("freshness contract", () => {
  it("never reads updated_at as a player freshness timestamp", () => {
    const unjustified = filesUsingUpdatedAt().filter(
      (path) => !NON_FRESHNESS_UPDATED_AT.has(path),
    );

    expect(unjustified).toEqual([]);
  });

  it("keeps the justification list free of dead entries", () => {
    const using = new Set(filesUsingUpdatedAt());
    const stale = [...NON_FRESHNESS_UPDATED_AT.keys()].filter(
      (path) => !using.has(path),
    );

    expect(stale).toEqual([]);
  });
});
