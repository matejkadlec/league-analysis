import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";

import { allSourceFiles } from "./source-scan-support";

/**
 * Player freshness is `profile_synced_at` / `league_synced_at` /
 * `match_synced_at` — the timestamp of the provider check that actually
 * sourced the field. `updated_at` is a row-mutation timestamp: it moves when
 * anything on the row changes, so a card using it claims data is fresh when
 * only some unrelated column was touched.
 *
 * These files use `updated_at` for a record's own mutation time rather than
 * for player freshness, which is what it is for. Anything else must either
 * use a `*_synced_at` column or justify itself by being added here.
 */
const NON_FRESHNESS_UPDATED_AT = new Map([
  ["lib/core/schemas.ts", "declares the wire shape, does not display it"],
  [
    "features/settings/riot-api-settings-card.tsx",
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
