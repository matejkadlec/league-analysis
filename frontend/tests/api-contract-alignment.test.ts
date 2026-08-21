import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import * as exportedSchemas from "@/lib/core/schemas";

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
  return [base, `${base}Response`, `${base}Item`, base.replace(/Response$/, "")];
}

const openApiPath = process.env.OPENAPI_JSON;

describe("zod against the OpenAPI contract", () => {
  if (!openApiPath) {
    // Not a silent pass: `npm test` alone has no OpenAPI document to compare
    // against, and inventing one would be checking zod against itself.
    it.skip("needs OPENAPI_JSON, which ./test.sh supplies", () => {});
    return;
  }

  const apiSchemas = (
    JSON.parse(readFileSync(openApiPath, "utf8")) as {
      components: { schemas: Record<string, JsonSchema> };
    }
  ).components.schemas;

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
          [...set].filter((k) => k !== "null").sort().join("|");
        // A literal pins one value on both sides; zod serialises a numeric
        // literal as "number" where Python's Literal[1] is "integer".
        const zodConst = (resolve(zodJson, {}).properties as JsonSchema)[field];
        const apiConst = (resolve(apiSchemas[apiName], apiSchemas)
          .properties as JsonSchema)[field];
        const zc = resolve(zodConst, {}).const;
        const ac = resolve(apiConst, apiSchemas).const;
        if (zc !== undefined && zc === ac) continue;

        if (core(zodKinds) !== core(apiKinds)) {
          problems.push(
            `${field}: zod ${core(zodKinds) || "-"}, API ${core(apiKinds) || "-"}`,
          );
        }
        // `.optional()` accepts undefined and REJECTS null. Only `.nullable()`
        // accepts null, and Pydantic serialises an absent `X | None` as null.
        if (apiKinds.has("null") && !zodKinds.has("null")) {
          problems.push(`${field}: API may send null, zod does not accept null`);
        }
      }

      expect(problems).toEqual([]);
    },
  );
});
