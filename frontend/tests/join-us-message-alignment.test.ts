import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  JOIN_US_BODY_MAX_LENGTH,
  JOIN_US_BODY_MIN_LENGTH,
} from "@/features/auth/utils/join-us-message";

/**
 * The two halves of the rule live in different places on the backend, so they
 * are read from different places here: the maximum is a `max_length` that
 * reaches the OpenAPI document, the minimum a module constant reaching nothing.
 */
const BACKEND_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../backend",
);

// Where the constant lives, not where the flow lives: it moved from
// `service.py` to `join_us.py` with the Join Us extraction. The error below is
// the only thing that says which file to look in.
const MINIMUM_SOURCE = "app/features/auth/join_us/join_us.py";

function backendMinimumBodyLength(): number {
  const source = readFileSync(join(BACKEND_ROOT, MINIMUM_SOURCE), "utf8");
  const match = /^JOIN_US_MIN_BODY_LENGTH = (\d+)$/m.exec(source);
  if (!match?.[1]) {
    throw new Error(
      `JOIN_US_MIN_BODY_LENGTH is not a module-level literal in ${MINIMUM_SOURCE}; ` +
        "this check can no longer read the rule it compares",
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
