import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE_DIRECTORIES = ["app", "components", "features", "lib"];

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

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return [".ts", ".tsx"].includes(extname(entry.name)) ? [path] : [];
  });
}

/** Every inline `queryKey: [...]` literal, with the leading namespace string. */
function queryKeyUses(): QueryKeyUse[] {
  return SOURCE_DIRECTORIES.flatMap(sourceFiles).flatMap((path) => {
    const source = readFileSync(path, "utf8");
    const uses: QueryKeyUse[] = [];

    // [^\]] already spans newlines, so no dotall flag is needed.
    for (const match of source.matchAll(/queryKey:\s*\[([^\]]*)\]/g)) {
      const body = match[1];
      const namespace = /^\s*"([^"]+)"/.exec(body)?.[1];
      // A key built from a factory or spread is checked at the factory.
      if (!namespace) {
        continue;
      }
      uses.push({
        file: relative(process.cwd(), path),
        line: source.slice(0, match.index).split("\n").length,
        namespace,
        carriesPuuid: /puuid/i.test(body),
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
