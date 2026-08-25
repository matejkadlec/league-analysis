import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";

import { allSourceFiles } from "./source-scan-support";

/**
 * Query keys that are genuinely global: the same for every player. Anything
 * not here is player-derived and must carry the exact PUUID everywhere,
 * because a prefix invalidation without it refetches every cached player.
 */
const PLAYER_INDEPENDENT_KEYS = new Set([
  "job-executions",
  "job-executions-infinite",
  "job-status",
  "jobs",
  "player-context",
  "player-suggestions",
  "service-status",
  "settings",
  "tracked-players",
  // The signed-in account, not a League player: `USER_QUERY_KEY` in
  // `settings-helpers.ts`. It was outside this contract entirely until the
  // scan below learned to read key factories.
  "user",
]);

interface QueryKeyUse {
  file: string;
  line: number;
  namespace: string;
  carriesPuuid: boolean;
}

/**
 * Every key array this codebase writes, with its leading namespace string.
 * Both spellings count -- inline `queryKey: [...]` and the array a factory
 * returns -- or the last call site could move into a factory and drop the
 * namespace from this contract's view.
 */
const KEY_ARRAY_PATTERNS = [
  // [^\]] already spans newlines, so no dotall flag is needed.
  /queryKey:\s*\[([^\]]*)\]/g,
  /QUERY_KEY\s*=\s*\[([^\]]*)\]/g,
  /function\s+\w*QueryKey\b[^{]*\{[^}]*?return\s*\[([^\]]*)\]/g,
];

function queryKeyUses(): QueryKeyUse[] {
  return allSourceFiles().flatMap((path) => {
    const source = readFileSync(path, "utf8");
    const uses: QueryKeyUse[] = [];

    for (const match of KEY_ARRAY_PATTERNS.flatMap((pattern) => [
      ...source.matchAll(pattern),
    ])) {
      // A comment inside the array must not be read as a key element — it
      // would let `["matches", otherId /* puuid */]` pass as scoped.
      // The single capture group always participates in a successful match.
      const body = (match[1] ?? "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*/g, "");
      const namespace = /^\s*["']([^"']+)["']/.exec(body)?.[1];
      // A key built from a factory or spread is checked at the factory.
      if (!namespace) {
        continue;
      }
      uses.push({
        file: relative(process.cwd(), path),
        line: source.slice(0, match.index).split("\n").length,
        namespace,
        carriesPuuid: /\bpuuid\b/i.test(body),
      });
    }

    return uses;
  });
}

describe("query key scope contract", () => {
  it("scopes every player-derived key to an exact PUUID", () => {
    const unscoped = queryKeyUses()
      .filter(
        (use) =>
          !PLAYER_INDEPENDENT_KEYS.has(use.namespace) && !use.carriesPuuid,
      )
      .map((use) => `${use.file}:${use.line} ["${use.namespace}"]`);

    expect(unscoped).toEqual([]);
  });

  it("keeps the player-independent list free of dead entries", () => {
    const used = new Set(queryKeyUses().map((use) => use.namespace));
    const unused = [...PLAYER_INDEPENDENT_KEYS].filter((key) => !used.has(key));

    expect(unused).toEqual([]);
  });
});
