import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  DISPLAY_NAME_MAX_LENGTH,
  DISPLAY_NAME_MIN_LENGTH,
  DISPLAY_NAME_PATTERN,
} from "@/features/auth/utils/display-name";

/**
 * The display-name rule exists on both sides, so something has to hold it
 * equal -- the same problem `riot-id-alignment.test.ts` solves for Riot IDs.
 *
 * The settings form has always demanded three characters, a trim, and a
 * letters/marks/underscores/spaces pattern. `PATCH /auth/me` demanded one
 * character and nothing else, so the whole rule was browser-deep: any client
 * that was not the form set any 1-128 character string. The API now declares
 * all three, which puts them in the OpenAPI document -- and this reads them
 * back out.
 *
 * Needs `OPENAPI_JSON`, which `test.sh` produces for every `*-alignment` test;
 * without it there is nothing to compare against, so the check skips. What
 * keeps that skip honest is the convention check in
 * `api-contract-alignment.test.ts`, not this file.
 */
const openapiPath = process.env.OPENAPI_JSON;
const spec = openapiPath
  ? (JSON.parse(readFileSync(openapiPath, "utf8")) as {
      components: {
        schemas: Record<
          string,
          {
            properties?: Record<
              string,
              {
                minLength?: number;
                maxLength?: number;
                pattern?: string;
                anyOf?: {
                  minLength?: number;
                  maxLength?: number;
                  pattern?: string;
                }[];
              }
            >;
          }
        >;
      };
    })
  : null;

/**
 * `UserProfileUpdate.display_name` is optional, so its constraints sit inside
 * `anyOf` beside the null branch; `UserBase.display_name` is required and
 * carries them directly. Reading only the top level would silently find
 * `undefined` on the optional one and compare nothing.
 */
function displayNameConstraints(schemaName: string) {
  const property = spec?.components.schemas[schemaName]?.properties?.[
    "display_name"
  ];
  if (!property) {
    throw new Error(
      `${schemaName}.display_name is missing from the OpenAPI document`,
    );
  }
  const constrained =
    property.pattern === undefined
      ? property.anyOf?.find((branch) => branch.pattern !== undefined)
      : property;
  if (!constrained) {
    throw new Error(
      `${schemaName}.display_name declares no pattern; the rule is ` +
        `browser-deep again`,
    );
  }
  return constrained;
}

describe.runIf(spec)("display name rules match the API", () => {
  // The two write models: the settings form goes through `UserProfileUpdate`,
  // registration through `UserCreate`. `UserResponse` is deliberately excluded
  // -- see the comment on it in the backend schema.
  it.each(["UserCreate", "UserProfileUpdate"])(
    "%s declares the rule the form enforces",
    (schemaName) => {
      const constraints = displayNameConstraints(schemaName);

      expect(constraints.minLength).toBe(DISPLAY_NAME_MIN_LENGTH);
      expect(constraints.maxLength).toBe(DISPLAY_NAME_MAX_LENGTH);
      // The frontend literal carries the `u` flag and delimiters; compare the
      // source so a changed character class fails here rather than in a toast.
      expect(constraints.pattern).toBe(DISPLAY_NAME_PATTERN.source);
    },
  );
});
