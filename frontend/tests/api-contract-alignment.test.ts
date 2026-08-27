import { readFileSync } from "node:fs";
import { relative } from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { PLATFORM_DISPLAY_NAMES } from "@/lib/core/platform-utils";
import * as exportedSchemas from "@/lib/core/schemas";

import { allSourceFiles, allTestFiles } from "./source-scan-support";

import { MATCH_HISTORY_PAGE_SIZES } from "../features/matches/match-history-pagination";

// Pydantic -> zod, the half `backend/tests/test_model_schema_alignment.py`
// does not cover and the direction that has broken twice. Needs `OPENAPI_JSON`
// from `backend/scripts/dump_openapi.py`, which `./test.sh` supplies.

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

/**
 * The members of an enum node, following `$ref` and looking inside the
 * `anyOf` an optional field is wrapped in, or null when the node is not one.
 */
function enumMembers(
  node: unknown,
  spec: Record<string, JsonSchema>,
): string[] | null {
  const schema = resolve(node, spec);
  if (Array.isArray(schema.enum)) return schema.enum as string[];
  const union = (schema.anyOf ?? schema.oneOf) as unknown[] | undefined;
  if (!union) return null;
  const branches = union
    .map((sub) => enumMembers(sub, spec))
    .filter((members): members is string[] => members !== null);
  // Two enum branches in one union would make "the" member set a guess.
  return branches.length === 1 ? (branches[0] ?? null) : null;
}

/** Field -> enum members, for the fields on both sides that are enums. */
function enumFieldsOf(schema: unknown, spec: Record<string, JsonSchema>) {
  const resolved = resolve(schema, spec);
  const properties = (resolved.properties ?? {}) as Record<string, unknown>;
  return new Map(
    Object.entries(properties)
      .map(([name, sub]) => [name, enumMembers(sub, spec)] as const)
      .filter((entry): entry is [string, string[]] => entry[1] !== null),
  );
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
 * Reduce a call-site path to the shape OpenAPI writes: `${puuid}` becomes
 * `{}`, matching a `{puuid}` parameter, while an interpolation producing a
 * query string is dropped whole, because a query is not part of the path.
 */
function normalizeCallPath(literal: string): string {
  return literal
    .replace(/\$\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, (interpolation) =>
      /["'`]\?/.test(interpolation) ? "" : "{}",
    )
    .replace(/\?.*$/, "");
}

/**
 * The API path a call site names, or null when it names something else. The
 * helpers take a path relative to the prefix; `fetch` also fetches page routes
 * and static assets, so only a literal carrying the prefix counts there.
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

/**
 * The helpers whose next argument is a query-parameter object, by HTTP method.
 * `validatedPost` takes one too, in fourth position after the body; no call
 * site uses it, so it is not read here.
 */
const QUERY_HELPERS = new Map([
  ["validatedGet", "get"],
  ["validatedDelete", "delete"],
  ["api.get", "get"],
  ["api.delete", "delete"],
]);

/** The object literal that follows a path argument, or null if there is none. */
function paramsObjectAfter(source: string): string | null {
  const separator = /^\s*,\s*/.exec(source);
  if (!separator) return null;
  const rest = source.slice(separator[0].length);
  if (!rest.startsWith("{")) return null;
  let depth = 0;
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === "{") depth += 1;
    else if (rest[i] === "}") {
      depth -= 1;
      if (depth === 0) return rest.slice(0, i + 1);
    }
  }
  return null;
}

interface QueryCall {
  key: string;
  names: Set<string>;
  file: string;
  /** False when a params argument is present but is not a bare object. */
  resolved: boolean;
}

/** Whether a real argument follows the path, ignoring a trailing comma. */
function hasFurtherArgument(after: string): boolean {
  const next = /^\s*,\s*([\s\S])/.exec(after);
  return next !== null && next[1] !== ")";
}

/**
 * Whether the params slot is a literal `undefined` -- what a call site writes
 * to reach a later argument, and readable as "sends nothing" rather than as an
 * argument this cannot resolve.
 */
function passesNoParams(after: string): boolean {
  return /^\s*,\s*undefined\s*(?=[,)])/.test(after);
}

/**
 * The query names every call site sends -- one entry per call site, not per
 * endpoint, since keying by endpoint drops all but one site on a shared path.
 * Both the object literal and a `?name=` written into the path count.
 */
function calledQueryParams(): QueryCall[] {
  const calls: QueryCall[] = [];
  for (const file of allSourceFiles()) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(CALL_SITE)) {
      const method = QUERY_HELPERS.get(match[1] ?? "");
      if (!method) continue;
      const from = match.index + match[0].length;
      const window = source.slice(from, from + 900);
      const literal = ANY_LITERAL.exec(window);
      if (!literal) continue;
      const raw = literal[1] ?? literal[2] ?? literal[3] ?? "";
      const apiPath = apiPathFrom(match[1] ?? "", raw);
      if (apiPath === null) continue;

      const names = new Set(
        [...apiPath.matchAll(/[?&]([a-zA-Z_]\w*)=/g)].map((m) => m[1] as string),
      );
      const after = window.slice(literal.index + literal[0].length);
      const body = paramsObjectAfter(after);
      if (body) {
        // Comments first. A `//` line inside the object leaves the first key
        // with no `{` or `,` in front of it, so neither pattern below matches
        // and the site reports no names -- green, and checking nothing.

        // Nested braces are NOT stripped. `QueryParams` admits only string,
        // number and boolean, so every brace inside the argument belongs to a
        // conditional spread, which names a real parameter.
        const top = body
          .slice(1, -1)
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/\/\/[^\n]*/g, "");
        for (const re of [/(?:^|,)\s*(?:\.\.\.)?([a-zA-Z_]\w*)\s*(?=[,:}]|$)/g, /(?:^|[{,])\s*([a-zA-Z_]\w*)\s*:/g]) {
          for (const m of top.matchAll(re)) names.add(m[1] as string);
        }
      }
      calls.push({
        key: `${method} ${normalizeCallPath(apiPath)}`,
        names,
        file: `${relative(process.cwd(), file)}`,
        // A params argument this cannot read is not the same as no params: a
        // ternary of two object literals reads as sending nothing, which
        // passes. A trailing comma before `)` is not an argument.
        resolved:
          body !== null || !hasFurtherArgument(after) || passesNoParams(after),
      });
    }
  }
  return calls;
}

const openApiPath = process.env.OPENAPI_JSON;

// Reported as skipped rather than passed: `npm test` alone has no document to
// compare against, and inventing one would check zod against itself. The empty
// stand-in only feeds collection, which vitest runs for a skipped suite too.
describe.skipIf(openApiPath === undefined)("zod against the OpenAPI contract", () => {
  const document = (
    openApiPath === undefined
      ? { components: { schemas: {} }, paths: {} }
      : JSON.parse(readFileSync(openApiPath, "utf8"))
  ) as {
    components: { schemas: Record<string, JsonSchema> };
    paths: Record<string, unknown>;
  };
  const apiSchemas = document.components.schemas;

  /**
   * Nothing else checks this: a route renamed on the backend leaves every zod
   * schema, type and test here green, and the call 404s at runtime for whoever
   * opens the page.
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

  /**
   * Quieter than a wrong request body: FastAPI drops an undeclared *query*
   * name and uses the parameter's default, so a renamed one returns 200 and
   * answers a different question. A missing required one is the loud 422.
   */
  it("names only query parameters the API declares", () => {
    const declared = new Map<
      string,
      { names: Set<string>; required: Set<string> }
    >();
    for (const [path, operations] of Object.entries(document.paths)) {
      for (const [method, op] of Object.entries(
        operations as Record<string, unknown>,
      )) {
        if (typeof op !== "object" || op === null) continue;
        const parameters =
          (op as { parameters?: { name: string; in: string; required?: boolean }[] })
            .parameters ?? [];
        const query = parameters.filter((p) => p.in === "query");
        const key = `${method} ${path.slice(API_PREFIX.length).replace(/\{[^}]*\}/g, "{}")}`;
        declared.set(key, {
          names: new Set(query.map((p) => p.name)),
          required: new Set(
            query.filter((p) => p.required).map((p) => p.name),
          ),
        });
      }
    }

    const called = calledQueryParams();
    // Signal first: an extractor that stopped resolving call sites would pass
    // by having nothing to compare.
    expect(called.length).toBeGreaterThanOrEqual(28);
    // Sites found is the wrong number to guard on: a site whose argument the
    // extractor cannot read is still counted, contributes no names, and
    // compares nothing. Count the names that actually got compared.
    const compared = called.reduce((total, call) => total + call.names.size, 0);
    expect(compared).toBeGreaterThanOrEqual(20);

    const problems: string[] = [];
    for (const { key, names, file, resolved } of called) {
      const spec = declared.get(key);
      // An unserved path is the path rule's finding, not this one's.
      if (!spec) continue;
      if (!resolved) {
        problems.push(
          `${key} passes params this cannot read, so its names go unchecked -- ` +
            `write a plain object literal (${file})`,
        );
        continue;
      }
      for (const name of names) {
        if (!spec.names.has(name)) {
          problems.push(`${key} sends \`${name}\`, which it does not accept (${file})`);
        }
      }
      for (const name of spec.required) {
        if (!names.has(name)) {
          problems.push(`${key} omits required \`${name}\` (${file})`);
        }
      }
    }

    expect(problems).toEqual([]);
  });

  /**
   * Two hand-maintained lists of numbers with nothing connecting them, and the
   * largest option is exactly the endpoint's ceiling -- so a new picker option,
   * or a lowered backend bound, is a 422 on a real click.
   */
  it("offers only page sizes the match endpoint accepts", () => {
    const detailed = document.paths[
      `${API_PREFIX}/matches/player/{puuid}/detailed`
    ] as
      | { get?: { parameters?: { name: string; schema: JsonSchema }[] } }
      | undefined;
    const count = detailed?.get?.parameters?.find((p) => p.name === "count");
    // Signal first: a renamed parameter, or one that lost its bounds, would
    // leave nothing to compare and every page size would pass by default.
    expect(
      count?.schema.maximum,
      "the detailed-matches `count` parameter has no maximum",
    ).toBeTypeOf("number");

    const minimum = Number(count?.schema.minimum ?? 1);
    const maximum = Number(count?.schema.maximum);
    const rejected = MATCH_HISTORY_PAGE_SIZES.filter(
      (size) => size < minimum || size > maximum,
    );

    expect(rejected).toEqual([]);
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

  /** Every component the API accepts as a request body, by name. */
  const requestBodyComponents = new Set(
    Object.values(document.paths).flatMap((operations) =>
      Object.values(operations as Record<string, unknown>).flatMap((op) => {
        if (typeof op !== "object" || op === null) return [];
        const content = (
          op as { requestBody?: { content?: Record<string, JsonSchema> } }
        ).requestBody?.content;
        if (!content) return [];
        return Object.values(content).flatMap((media) => {
          const ref = (media.schema as JsonSchema | undefined)?.$ref;
          return typeof ref === "string" ? [ref.split("/").pop() as string] : [];
        });
      }),
    ),
  );

  const requestPairs = pairs.filter(([, apiName]) =>
    requestBodyComponents.has(apiName),
  );

  it("finds the request bodies to check", () => {
    // These pair by name, so a renamed schema drops out silently and every
    // rule below passes by having nothing to run. The floor is the exact count,
    // not the count minus slack -- slack is room for a rename to go unnoticed.
    expect(requestPairs.length).toBeGreaterThanOrEqual(11);
  });

  /**
   * The other direction, which only a request needs: a field zod lacks is one
   * the frontend never sends, a field the API lacks is one FastAPI rejects.
   * `validatedPost` takes the body as `unknown`, so tsc sees neither.
   */
  it.each(requestPairs.map(([name, apiName]) => [name, apiName]))(
    "%s sends exactly what %s accepts",
    (name) => {
      const [, apiName, zodJson] = requestPairs.find(([n]) => n === name)!;
      const zodFields = fieldsOf(zodJson, {});
      const api = resolve(apiSchemas[apiName], apiSchemas);
      const apiFields = new Set(
        Object.keys((api.properties as JsonSchema | undefined) ?? {}),
      );
      const required = (api.required as string[] | undefined) ?? [];
      // Required-ness, not presence: under `io: "input"` an `.optional()` zod
      // field still appears in `properties`. Zod requiring more is always
      // legal, so this runs one way only.
      const zodRequired = new Set(
        (resolve(zodJson, {}).required as string[] | undefined) ?? [],
      );

      expect(
        required.filter((field) => !zodRequired.has(field)),
        `${name} does not require fields ${apiName} requires`,
      ).toEqual([]);
      expect(
        [...zodFields.keys()].filter((field) => !apiFields.has(field)),
        `${name} sends fields ${apiName} does not declare`,
      ).toEqual([]);
    },
  );

  it("names every platform the API accepts", () => {
    // The only thing tying the frontend's platform vocabulary to the API's:
    // `kinds()` below reduces both to "string". A platform missing from the
    // display-name table fails `PlayerSchema` for every player on it.
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
        // membership drift is invisible to it. A wider zod stays legal; a
        // narrower one is the failure.

        // ponytail: reads the enum off the direct property node only, so a
        // nullable enum, one inside an array, and one in a union arm are all
        // invisible. Walk those shapes when a paired field becomes one.
        const zodEnum = zr.enum as unknown[] | undefined;
        const apiEnum = ar.enum as unknown[] | undefined;
        // A closed set on the API against an open `z.string()` here. Worse than
        // a parse failure: the value reaches React as a plain string and every
        // consumer carries a branch for a member that cannot occur.
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
        // And the mirror: a zod field accepting a null the API cannot send is
        // a field whose absence no longer fails, so renaming the column behind
        // it leaves every parse green.
        if (!apiKinds.has("null") && zodKinds.has("null")) {
          problems.push(
            `${field}: zod accepts null, API never sends it -- drop .nullable()`,
          );
        }
      }

      expect(problems).toEqual([]);
    },
  );

  it.each(pairs.map(([name, apiName]) => [name, apiName]))(
    "%s knows every value %s can send",
    (name) => {
      // `kinds()` cannot do this: it reduces a `$ref`-to-enum and a `z.enum`
      // alike to "string". A member missing here fails the zod parse for every
      // response carrying it -- an error toast, not a 422.
      const [, apiName, zodJson] = pairs.find(([n]) => n === name)!;
      const zodEnums = enumFieldsOf(zodJson, {});
      const apiEnums = enumFieldsOf(apiSchemas[apiName], apiSchemas);
      const problems: string[] = [];

      for (const [field, apiValues] of apiEnums) {
        const zodValues = zodEnums.get(field);
        if (!zodValues) continue;
        const missing = apiValues.filter((v) => !zodValues.includes(v));
        const invented = zodValues.filter((v) => !apiValues.includes(v));
        if (missing.length) {
          problems.push(
            `${field}: API can send ${missing.join(", ")}, zod rejects it`,
          );
        }
        if (invented.length) {
          problems.push(
            `${field}: zod accepts ${invented.join(", ")}, API never sends it`,
          );
        }
      }

      expect(problems).toEqual([]);
    },
  );

  it("compares enough enum fields to be worth trusting", () => {
    // The check above passes by finding nothing if either extractor stops
    // recognising an enum, so assert on what it CHECKED rather than on it
    // having found no problems.
    const compared = pairs.flatMap(([, apiName, zodJson]) => {
      const zodEnums = enumFieldsOf(zodJson, {});
      return [...enumFieldsOf(apiSchemas[apiName], apiSchemas).keys()].filter(
        (field) => zodEnums.has(field),
      );
    });

    // 18 today. Adding an enum should raise this; a drop means the extractor
    // went blind, which is the failure this number exists to catch.
    expect(compared.length).toBeGreaterThanOrEqual(18);
  });
});

// `./test.sh` selects these checks by the `alignment` filter, so a reader of
// the document named outside it passes by comparing nothing. Scope is every
// test file naming `OPENAPI_JSON` itself, not one reaching it via a helper.
describe("the gate reaches every test that reads the OpenAPI document", () => {
  it("names every OPENAPI_JSON reader so the alignment filter selects it", () => {
    const strays = allTestFiles()
      .filter((path) => readFileSync(path, "utf8").includes("OPENAPI_JSON"))
      .filter((path) => !path.includes("alignment"));

    expect(strays, "rename these to *-alignment.test.ts").toEqual([]);
  });
});
