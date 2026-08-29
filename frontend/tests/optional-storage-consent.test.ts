import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { allSourceFiles } from "./support/source-scan-support";

/**
 * Withdrawing consent erases `OPTIONAL_STORAGE_KEYS` and nothing else, so a
 * key the app writes but that list does not name survives a withdrawal with
 * no error anywhere. These two checks are what make the single registry hold.
 */
const CONSENT_STORAGE = join(
  dirname(fileURLToPath(import.meta.url)),
  "../features/cookie-consent/consent-storage.ts",
);

function consentStorageSource(): string {
  const source = readFileSync(CONSENT_STORAGE, "utf8");
  if (!source.includes("OPTIONAL_STORAGE_KEYS")) {
    throw new Error(
      "consent-storage.ts no longer declares OPTIONAL_STORAGE_KEYS; this " +
        "check has nothing left to compare",
    );
  }
  return source;
}

describe("optional storage the viewer can withdraw", () => {
  it("clears every key it declares", () => {
    const source = consentStorageSource();
    const declared = [
      ...source.matchAll(/^export const (\w+_STORAGE_KEY)\s*=/gm),
    ].map((match) => match[1]!);
    const listBody = /const OPTIONAL_STORAGE_KEYS = \[([^\]]*)\]/.exec(source);
    if (!listBody?.[1]) {
      throw new Error("could not read the OPTIONAL_STORAGE_KEYS array body");
    }

    // Every declared key is in the list, and the list is built from constants
    // rather than repeating their values.
    expect(declared.length).toBeGreaterThanOrEqual(3);
    expect(
      declared.filter((name) => !listBody[1]!.includes(name)),
      "declared but never cleared on withdrawal",
    ).toEqual([]);
    expect(
      listBody[1]!.includes('"'),
      "OPTIONAL_STORAGE_KEYS holds a string literal; it must name constants",
    ).toBe(false);
  });

  it("is only ever written through those constants", () => {
    // A literal at a call site is a key the registry never learns about.
    const offenders = allSourceFiles().flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return [
        ...source.matchAll(/\b(?:read|write)OptionalStorage\s*\(\s*(.)/g),
      ]
        .filter((match) => match[1] === '"' || match[1] === "'" || match[1] === "`")
        .map(() => file);
    });

    expect(offenders, "pass a *_STORAGE_KEY constant, not a literal").toEqual(
      [],
    );
  });

  it("checks the call sites it claims to", () => {
    // Zero call sites found would pass the check above by scanning nothing.
    const callSites = allSourceFiles().reduce(
      (total, file) =>
        total +
        [
          ...readFileSync(file, "utf8").matchAll(
            /\b(?:read|write)OptionalStorage\s*\(/g,
          ),
        ].length,
      0,
    );

    expect(callSites).toBeGreaterThanOrEqual(4);
  });
});
