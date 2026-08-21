import { readFileSync } from "node:fs";
import { relative } from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { PLATFORM_DISPLAY_NAMES } from "@/lib/core/platform-utils";
import * as exportedSchemas from "@/lib/core/schemas";

import { allSourceFiles } from "./source-scan-support";

/**
 * Every zod schema must accept everything its OpenAPI counterpart may send.
 *
 * `backend/tests/test_model_schema_alignment.py` guards column -> Pydantic.
 * This is the other half, Pydantic -> zod, and it is the direction that has
 * broken twice: eight rune IDs that were `number` against an `integer`, and
 * `detailed_logs`, where Pydantic serialised an absent `X | None` as `null`
 * while zod said `.optional()` -- which accepts `undefined` and rejects
 * `null`. Both passed tsc, eslint and the whole suite.
 *
 * Needs `OPENAPI_JSON` pointing at `backend/scripts/dump_openapi.py` output;
 * `test.sh` produces it. Without it there is nothing to compare against, so
 * the check skips rather than pretending to pass.
 */

/** Schema pairs the FooSchema <-> Foo/FooResponse heuristic cannot see. */
const ALIASES: Record<string, string> = {
  ParticipantRunesSchema: "RunesData",
  JobExecutionApiCallSchema: "JobExecutionApiCall",
  SmurfBoostFamilySchema: "FamilyPayload",
  SmurfBoostSignalSchema: "SignalPayload",
  SmurfBoostPresetSchema: "PresetPayload",
  SmurfBoostPresetsResponseSchema: "PresetsResponse",
};

type JsonSchema = Record<string, unknown>;

function resolve(
  node: unknown,
  spec: Record<string, JsonSchema>,
  seen: readonly string[] = [],
): JsonSchema {
  if (typeof node !== "object" || node === null) return {};
  const schema = node as JsonSchema;
  const ref = schema.$ref;
  if (typeof ref === "string") {
    const name = ref.split("/").pop() ?? "";
    if (seen.includes(name)) return { type: "recursive" };
    return resolve(spec[name] ?? {}, spec, [...seen, name]);
  }
  return schema;
}

/** The set of JSON Schema type names a node can be, nulls included. */
function kinds(
  node: unknown,
  spec: Record<string, JsonSchema>,
  seen: readonly string[] = [],
): Set<string> {
  const schema = resolve(node, spec, seen);
  const union = (schema.anyOf ?? schema.oneOf) as unknown[] | undefined;
  if (union) {
    return new Set(union.flatMap((sub) => [...kinds(sub, spec, seen)]));
  }
  const declared = schema.type;
  if (Array.isArray(declared)) return new Set(declared as string[]);
  if (typeof declared === "string") return new Set([declared]);
  if (schema.enum) return new Set(["enum"]);
  if (schema.properties) return new Set(["object"]);
  return new Set(["any"]);
}

function fieldsOf(schema: unknown, spec: Record<string, JsonSchema>) {
  const resolved = resolve(schema, spec);
  const properties = (resolved.properties ?? {}) as Record<string, unknown>;
  return new Map(
    Object.entries(properties).map(([name, sub]) => [name, kinds(sub, spec)]),
  );
}

function apiCandidates(zodName: string): string[] {
  const alias = ALIASES[zodName];
  if (alias) return [alias];
  const base = zodName.replace(/Schema$/, "");
  return [
    base,
    `${base}Response`,
    `${base}Item`,
    base.replace(/Response$/, ""),
  ];
}

const API_PREFIX = "/api/v1";

/**
 * The calls that name a path: the validated client's helpers, the bare axios
 * instance, and the `fetch` sites in the auth infrastructure that predate the
 * client and are exempt from the no-raw-fetch hook.
 */
const CALL_SITE =
  /(validatedGet|validatedPost|validatedPut|validatedPatch|validatedDelete|api\.(?:get|post|put|patch|delete)|fetch)\s*(?:<[^>]*>)?\s*\(/g;
const ANY_LITERAL = /(?:`([^`]*)`|"([^"]*)"|'([^']*)')/;

/**
 * Reduce a call-site path to the shape OpenAPI writes.
 *
 * `${puuid}` becomes `{}`, matching a `{puuid}` parameter; an interpolation
 * that produces a query string (`${force ? "?force=true" : ""}`) is dropped
 * whole, because a query is not part of the path.
 */
function normalizeCallPath(literal: string): string {
  return literal
    .replace(/\$\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, (interpolation) =>
      /["'`]\?/.test(interpolation) ? "" : "{}",
    )
    .replace(/\?.*$/, "");
}

/**
 * The API path a call site names, or null when it names something else.
 *
 * The validated helpers and the axios instance take a path relative to the
 * prefix; `fetch` takes an absolute one, sometimes behind `${API_BASE_URL}`,
 * and is also used for page routes and static assets, which is why only a
 * literal carrying the prefix counts as an API call there.
 */
function apiPathFrom(helper: string, literal: string): string | null {
  const prefixed = literal.indexOf(API_PREFIX);
  if (prefixed !== -1) return literal.slice(prefixed + API_PREFIX.length);
  if (helper === "fetch") return null;
  return literal.startsWith("/") ? literal : null;
}

/** Every API path the frontend asks for, with the files that ask for it. */
function calledApiPaths(): Map<string, string[]> {
  const calls = new Map<string, string[]>();
  for (const file of allSourceFiles()) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(CALL_SITE)) {
      const from = match.index + match[0].length;
      const literal = ANY_LITERAL.exec(source.slice(from, from + 400));
      if (!literal) continue;
      const raw = literal[1] ?? literal[2] ?? literal[3] ?? "";
      const helper = match[1] ?? "";
      const apiPath = apiPathFrom(helper, raw);
      if (apiPath === null) continue;
      const path = normalizeCallPath(apiPath);
      calls.set(path, [
        ...(calls.get(path) ?? []),
        relative(process.cwd(), file),
      ]);
    }
  }
  return calls;
}

const openApiPath = process.env.OPENAPI_JSON;

describe("zod against the OpenAPI contract", () => {
  if (!openApiPath) {
    // Not a silent pass: `npm test` alone has no OpenAPI document to compare
    // against, and inventing one would be checking zod against itself.
    it.skip("needs OPENAPI_JSON, which ./test.sh supplies", () => {});
    return;
  }

  const document = JSON.parse(readFileSync(openApiPath, "utf8")) as {
    components: { schemas: Record<string, JsonSchema> };
    paths: Record<string, unknown>;
  };
  const apiSchemas = document.components.schemas;

  /**
   * Every path the frontend calls must be one the backend serves.
   *
   * Nothing else checks this: a route renamed or moved on the backend leaves
   * every zod schema, type and test here green, and the call 404s at runtime
   * for whoever opens the page. The paths in this repo are template literals
   * over a helper, so they are readable statically.
   */
  it("asks only for paths the API serves", () => {
    const served = new Set(
      Object.keys(document.paths).map((path) =>
        path.slice(API_PREFIX.length).replace(/\{[^}]*\}/g, "{}"),
      ),
    );
    const called = calledApiPaths();
    // Signal first: an extractor that stopped finding call sites would pass by
    // having nothing to check.
    expect(called.size).toBeGreaterThanOrEqual(40);

    const unserved = [...called]
      .filter(([path]) => !served.has(path))
      .map(([path, files]) => `${path} (${files.join(", ")})`);

    expect(unserved).toEqual([]);
  });

  const pairs = Object.entries(exportedSchemas).flatMap(([name, value]) => {
    if (!(value instanceof z.ZodType)) return [];
    const apiName = apiCandidates(name).find((c) => c in apiSchemas);
    if (!apiName) return [];
    const zodJson = z.toJSONSchema(value, {
      io: "input",
      unrepresentable: "any",
    }) as JsonSchema;
    // An enum has no fields, so every field of a same-named object would read
    // as missing -- that is a collision in the name heuristic, not a contract.
    if (!resolve(zodJson, {}).properties) return [];
    return [[name, apiName, zodJson] as const];
  });

  it("pairs enough schemas to be worth running", () => {
    expect(pairs.length).toBeGreaterThan(20);
  });

  it("names every platform the API accepts", () => {
    // Not a schema pair, and `kinds()` below could not check it if it were:
    // it reduces both a `$ref`-to-enum and a `z.enum` to "string". This is
    // the only thing tying the frontend's platform vocabulary to the API's.
    // A platform added on the backend and missing from the display-name table
    // now fails `PlayerSchema` for every player on it, rather than merely
    // going unoffered by the picker.
    const platform = apiSchemas.Platform as { enum?: string[] } | undefined;
    expect(platform?.enum, "OpenAPI has no Platform enum").toBeTruthy();
    expect(new Set(Object.keys(PLATFORM_DISPLAY_NAMES))).toEqual(
      new Set(platform?.enum),
    );
  });

  it.each(pairs.map(([name, apiName]) => [name, apiName]))(
    "%s accepts everything %s sends",
    (name) => {
      const [, apiName, zodJson] = pairs.find(([n]) => n === name)!;
      const zodFields = fieldsOf(zodJson, {});
      const apiFields = fieldsOf(apiSchemas[apiName], apiSchemas);
      const problems: string[] = [];

      for (const [field, apiKinds] of apiFields) {
        const zodKinds = zodFields.get(field);
        if (!zodKinds || zodKinds.has("any") || apiKinds.has("any")) continue;
        const core = (set: Set<string>) =>
          [...set]
            .filter((k) => k !== "null")
            .sort()
            .join("|");
        // A literal pins one value on both sides; zod serialises a numeric
        // literal as "number" where Python's Literal[1] is "integer".
        const zodConst = (resolve(zodJson, {}).properties as JsonSchema)[field];
        const apiConst = (
          resolve(apiSchemas[apiName], apiSchemas).properties as JsonSchema
        )[field];
        const zr = resolve(zodConst, {});
        const ar = resolve(apiConst, apiSchemas);
        if (zr.const !== undefined && zr.const === ar.const) continue;

        // `kinds()` reduces an enum to the "string" it also declares, so
        // membership drift used to be invisible here: a Python `Literal`
        // gaining a member against a `z.enum` that did not compared equal.
        // A wider zod stays legal; a narrower one is the failure.
        //
        // ponytail: reads the enum off the direct property node only, so a
        // nullable enum (`anyOf: [enum, null]`), an enum inside an array, and
        // an enum in a discriminated-union arm are all still invisible. No
        // paired field is any of those today.
        const zodEnum = zr.enum as unknown[] | undefined;
        const apiEnum = ar.enum as unknown[] | undefined;
        // A closed set on the API against an open `z.string()` here. Not a
        // parse failure -- it is worse than that, because the value reaches
        // React as a plain string and every consumer has to carry a branch for
        // a member that cannot occur. `tier` was this, and `getRankColors`
        // kept a grey fallback for it.
        if (apiEnum && !zodEnum) {
          problems.push(
            `${field}: API sends one of ${apiEnum.length} enum members, zod says string`,
          );
        }
        if (zodEnum && apiEnum) {
          const missing = apiEnum.filter((value) => !zodEnum.includes(value));
          if (missing.length) {
            problems.push(
              `${field}: API may send ${missing.join(", ")}, zod rejects`,
            );
          }
        }

        if (core(zodKinds) !== core(apiKinds)) {
          problems.push(
            `${field}: zod ${core(zodKinds) || "-"}, API ${core(apiKinds) || "-"}`,
          );
        }
        // `.optional()` accepts undefined and REJECTS null. Only `.nullable()`
        // accepts null, and Pydantic serialises an absent `X | None` as null.
        if (apiKinds.has("null") && !zodKinds.has("null")) {
          problems.push(
            `${field}: API may send null, zod does not accept null`,
          );
        }
        // And the mirror. A zod field that accepts a null the API cannot send
        // is a field whose absence no longer fails: five `core.matches`
        // columns were NOT NULL in the DDL, `| None` in the response model and
        // `.optional().nullable()` here, so renaming any of them on the
        // backend would have left every parse in this suite green.
        if (!apiKinds.has("null") && zodKinds.has("null")) {
          problems.push(
            `${field}: zod accepts null, API never sends it -- drop .nullable()`,
          );
        }
      }

      expect(problems).toEqual([]);
    },
  );
});
