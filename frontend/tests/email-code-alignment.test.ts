import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { EMAIL_CODE_LENGTH } from "@/features/settings/settings-helpers";

/**
 * Holds the form's box count equal to the API's `code` pattern: a backend
 * moved to eight digits would 422 every code typed into six boxes.
 */
const openapiPath = process.env.OPENAPI_JSON;
const spec = openapiPath
  ? (JSON.parse(readFileSync(openapiPath, "utf8")) as {
      components: {
        schemas: Record<
          string,
          { properties?: Record<string, { pattern?: string }> }
        >;
      };
    })
  : null;

describe.runIf(spec)("email code inputs match the API", () => {
  it("renders one input per digit the API accepts", () => {
    const pattern = spec?.components.schemas["EmailChangeVerifyRequest"]
      ?.properties?.["code"]?.pattern;
    if (pattern === undefined) {
      throw new Error(
        "EmailChangeVerifyRequest.code declares no pattern; the digit count " +
          "is no longer published and this check compares nothing",
      );
    }

    // `^\d{6}$` -- the count is the only part that varies, so read it rather
    // than matching the whole string, which would fail on a harmless rewrite.
    const digits = /^\^\\d\{(\d+)\}\$$/.exec(pattern);
    if (!digits?.[1]) {
      throw new Error(
        `EmailChangeVerifyRequest.code pattern ${pattern} is no longer a ` +
          `fixed run of digits; the form's fixed input count may not fit it`,
      );
    }

    expect(EMAIL_CODE_LENGTH).toBe(Number(digits[1]));
  });
});
