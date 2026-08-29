import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { isPasswordStrong } from "@/features/settings/settings-helpers";

/**
 * The password policy is written twice and nothing else notices when they
 * disagree: `validate_password_strength` is a Pydantic field validator, so its
 * regexes never reach the OpenAPI document. This reads the backend source.
 */

const BACKEND_SCHEMAS = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../backend/app/features/auth/schemas.py",
);

function backendPolicy() {
  const source = readFileSync(BACKEND_SCHEMAS, "utf8");
  const pattern = /^SPECIAL_CHARACTER_PATTERN = r"(.*)"$/m.exec(source);
  const floor = /if len\(value\) < (\d+):/.exec(source);
  expect(pattern, "SPECIAL_CHARACTER_PATTERN moved or changed shape").toBeTruthy();
  expect(floor, "the length floor moved or changed shape").toBeTruthy();
  return {
    // No `u` flag: the backend's `\"` is a legal identity escape in
    // non-unicode mode and a SyntaxError in unicode mode.
    special: new RegExp(pattern?.[1] ?? ""),
    minimumLength: Number(floor?.[1]),
  };
}

/** Satisfies lower, upper and digit, so only the last character can decide. */
const CARRIER = "aaAA11a";

describe("the password policy the server enforces", () => {
  it("uses the length floor the client checks against", () => {
    const { minimumLength } = backendPolicy();
    // Every class satisfied up front, so only length can decide either way.
    const atFloor = "aA1!".padEnd(minimumLength, "x");
    expect(atFloor).toHaveLength(minimumLength);
    expect(isPasswordStrong(atFloor)).toBe(true);
    expect(isPasswordStrong(atFloor.slice(0, minimumLength - 1))).toBe(false);
  });

  it("accepts exactly the special characters the client accepts", () => {
    const { special } = backendPolicy();
    const disagreements: string[] = [];
    for (let code = 0x20; code <= 0x7e; code += 1) {
      const character = String.fromCharCode(code);
      const backendAccepts = special.test(character);
      const clientAccepts = isPasswordStrong(CARRIER + character);
      if (backendAccepts !== clientAccepts) {
        disagreements.push(
          `${JSON.stringify(character)}: backend ${backendAccepts}, client ${clientAccepts}`,
        );
      }
    }
    expect(disagreements).toEqual([]);
  });

  it("requires all four character classes on both sides", () => {
    // The carrier alone has no special character, so it must fail; each
    // single-class removal must fail too.
    expect(isPasswordStrong(CARRIER)).toBe(false);
    expect(isPasswordStrong("aaaa11a!")).toBe(false);
    expect(isPasswordStrong("AAAA11A!")).toBe(false);
    expect(isPasswordStrong("aaAAaaa!")).toBe(false);
    expect(isPasswordStrong(`${CARRIER}!`)).toBe(true);
  });
});
