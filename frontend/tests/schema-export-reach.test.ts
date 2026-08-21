import { readFileSync } from "node:fs";
import { relative } from "node:path";

import { describe, expect, it } from "vitest";

import { allSourceFiles, allTestFiles } from "./source-scan-support";

/**
 * Every export of `lib/core/schemas/` is reached by something.
 *
 * `npm run deadcode` cannot answer this. `api-contract-alignment.test.ts`
 * imports the whole module namespace to pair schemas to OpenAPI components by
 * name, knip counts a namespace import as a use of every export, and the
 * `export *` barrel forwards that blindness to all nine modules behind it --
 * the largest export list in the repo, and the one place knip reports zero
 * unused exports no matter what is in it. Eleven type aliases were reachable
 * from nothing at all while it said so.
 *
 * So this counts references itself. A name is reached when it is mentioned
 * anywhere outside its own declaration and outside the `z.infer` alias that
 * pairs to it -- that pairing is the schema's own restatement, not a reader.
 *
 * Both exclusions are matched against whole file text rather than single
 * lines, because Prettier wraps the longer aliases:
 *
 *     export type UserCookieConsentUpdate = z.infer<
 *       typeof UserCookieConsentUpdateSchema
 *     >;
 *
 * A line-level rule sees `typeof UserCookieConsentUpdateSchema` sitting on a
 * line of its own, counts it as a reader, and reports the schema as reached --
 * which it did, for four schemas including one of the two that motivated this
 * check in the first place.
 *
 * Comments are stripped first, as `branded-style-contract.test.ts` does: the
 * files here name schemas in prose freely, and a doc comment mentioning one
 * would otherwise mark it read.
 */
const SCHEMA_DIRECTORY = "lib/core/schemas";

/**
 * Request-body schemas whose only reader is the contract test, by design.
 *
 * `validatedPost` validates the *response* and takes the body as `unknown`,
 * so a request schema has no call site to be named at: the body is typed by
 * the `z.infer` alias instead, and the schema value exists to be paired
 * against the OpenAPI component the endpoint accepts. Deleting one would
 * silently drop that endpoint's body from the alignment check, which is the
 * failure this list is here to prevent -- a name leaves it by gaining a
 * reader, not by being added to it.
 */
const PAIRED_BY_THE_CONTRACT_TEST = new Set([
  "CardPreferenceUpdateSchema",
  "CurrentPlayerUpdateSchema",
  "EmailChangeRequestSchema",
  "EmailChangeVerifyRequestSchema",
  "JoinUsContactRequestSchema",
  "MatchmakingAnalysisRequestSchema",
  "PasswordChangeRequestSchema",
  "SettingUpdateSchema",
  "SmurfBoostAnalysisRequestSchema",
  "UserCookieConsentUpdateSchema",
  "UserProfileUpdateSchema",
]);

/** `export const|function|type|interface|class|enum <Name>`, at line start. */
const EXPORTED_NAME = /^export\s+(?:const|function|type|interface|class|enum)\s+([A-Za-z0-9_]+)/gm;

function schemaModules(): string[] {
  return allSourceFiles().filter(
    (path) =>
      path.startsWith(`${SCHEMA_DIRECTORY}/`) && !path.endsWith("index.ts"),
  );
}

function exportedNames(): Map<string, string> {
  const names = new Map<string, string>();
  for (const path of schemaModules()) {
    for (const match of readFileSync(path, "utf8").matchAll(EXPORTED_NAME)) {
      names.set(match[1] as string, relative(process.cwd(), path));
    }
  }
  return names;
}

/**
 * Every line a reader could live on, except this file's own.
 *
 * The allowance below names its schemas in order to exempt them, which is a
 * mention like any other -- `source-scan-support.ts` keeps `tests/` out of
 * `allSourceFiles` for exactly this reason, and a contract that scans itself
 * reports every name it discusses as reached.
 */
/** Source with comments removed, so prose about a schema is not a use. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*/g, "");
}

function everySource(): string[] {
  const self = "tests/schema-export-reach.test.ts";
  return [...new Set([...allSourceFiles(), ...allTestFiles()])]
    .filter((path) => relative(process.cwd(), path) !== self)
    .map(code);
}

function isReached(name: string, sources: readonly string[]): boolean {
  const mention = new RegExp(`\\b${name}\\b`);
  // `\s` spans newlines, so this matches the wrapped alias as well as the
  // one-line one. Only the alias that names *this* schema is removed.
  const pairedAlias = new RegExp(
    `^export\\s+type\\s+\\w+\\s*=\\s*z\\.infer<\\s*typeof\\s+${name}\\s*>;`,
    "gm",
  );
  // Head only: an initializer that names other schemas is a use of those.
  const declaration = new RegExp(
    `^export\\s+(?:const|function|type|interface|class|enum)\\s+${name}\\b`,
    "gm",
  );
  return sources.some((source) =>
    mention.test(source.replace(pairedAlias, "").replace(declaration, "export")),
  );
}

describe("every schema export is reached", () => {
  it("scans the modules it is written against", () => {
    // Signal first: this check is a scan, and a scan that stopped matching
    // reports nothing wrong with what it can no longer see. Both floors are
    // the counts as they stand, not those minus slack.
    expect(schemaModules().length).toBeGreaterThanOrEqual(9);
    expect(exportedNames().size).toBeGreaterThanOrEqual(120);
  });

  it("leaves no export that nothing reads", () => {
    const sources = everySource();
    const unreached = [...exportedNames()]
      .filter(([name]) => !PAIRED_BY_THE_CONTRACT_TEST.has(name))
      .filter(([name]) => !isReached(name, sources))
      .map(([name, module]) => `${name} (${module})`)
      .sort();

    expect(unreached).toEqual([]);
  });

  it("keeps the contract-test allowance honest", () => {
    // A name that gained a reader does not belong on the list any more, and a
    // name that was deleted outright would sit there forever pointing at
    // nothing. Either way the list stops describing the code.
    const sources = everySource();
    const names = exportedNames();
    const stale = [...PAIRED_BY_THE_CONTRACT_TEST]
      .filter((name) => !names.has(name) || isReached(name, sources))
      .sort();

    expect(stale).toEqual([]);
  });
});
