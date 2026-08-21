import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  JOIN_US_BODY_MAX_LENGTH,
  JOIN_US_BODY_MIN_LENGTH,
} from "@/features/auth/utils/join-us-message";

/**
 * The Join Us message bounds are written on both sides, and the two halves of
 * the rule live in different places on the backend, so they are read from
 * different places here.
 *
 * The maximum is a `max_length` on the request schema, so it reaches the
 * OpenAPI document. The minimum is a plain module constant the service
 * compares against and reaches nothing -- the form's counter is the only
 * reason a user ever sees it before submitting, and a form that disagreed
 * would either block a message the API would take or invite a 422.
 */
const BACKEND_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../backend",
);

function backendMinimumBodyLength(): number {
  const source = readFileSync(
    join(BACKEND_ROOT, "app/features/auth/service.py"),
    "utf8",
  );
  const match = /^JOIN_US_MIN_BODY_LENGTH = (\d+)$/m.exec(source);
  if (!match?.[1]) {
    throw new Error(
      "JOIN_US_MIN_BODY_LENGTH is not a module-level literal in " +
        "auth/service.py; this check can no longer read the rule it compares",
    );
  }
  return Number(match[1]);
}

it("the form's minimum is the one the service enforces", () => {
  expect(JOIN_US_BODY_MIN_LENGTH).toBe(backendMinimumBodyLength());
});

const openapiPath = process.env.OPENAPI_JSON;
const spec = openapiPath
  ? (JSON.parse(readFileSync(openapiPath, "utf8")) as {
      components: {
        schemas: Record<
          string,
          { properties?: Record<string, { maxLength?: number }> }
        >;
      };
    })
  : null;

describe.runIf(spec)("join us body maximum matches the API", () => {
  it("caps the textarea at the length the request schema accepts", () => {
    const body = spec?.components.schemas["JoinUsContactRequest"]?.properties?.[
      "body"
    ];
    if (body?.maxLength === undefined) {
      throw new Error(
        "JoinUsContactRequest.body declares no maxLength; the textarea cap " +
          "is guessing",
      );
    }

    expect(JOIN_US_BODY_MAX_LENGTH).toBe(body.maxLength);
  });
});
