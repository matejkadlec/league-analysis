import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";

import { allSourceFiles } from "./source-scan-support";

/**
 * Query keys that are genuinely global — they describe the service, the
 * signed-in user, or an admin view, and are the same for every player. This
 * list is the contract: anything not on it is player-derived and must carry
 * the exact PUUID, in every occurrence including invalidations.
 *
 * Adding a name here is a claim that the data does not vary by player. A
 * prefix invalidation without the PUUID matches every cached player, so an
 * update to one of them refetches all the others.
 */
const PLAYER_INDEPENDENT_KEYS = new Set([
  "apiKeyStatus",
  "job-executions",
  "job-executions-all",
  "job-executions-infinite",
  "job-status",
  "jobs",
  "player-context",
  "player-suggestions",
  "service-status",
  "settings",
  "tracked-players",
]);

interface QueryKeyUse {
  file: string;
  line: number;
  namespace: string;
  carriesPuuid: boolean;
}

/** Every inline `queryKey: [...]` literal, with the leading namespace string. */
function queryKeyUses(): QueryKeyUse[] {
  return allSourceFiles().flatMap((path) => {
    const source = readFileSync(path, "utf8");
    const uses: QueryKeyUse[] = [];

    // [^\]] already spans newlines, so no dotall flag is needed.
    for (const match of source.matchAll(/queryKey:\s*\[([^\]]*)\]/g)) {
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
