import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every error code this UI branches on must be one the API can send: a code
 * renamed on the backend leaves the branch dead with nothing failing.
 */

const here = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(here, "../../backend/app");

/** Codes the client mints itself, with no server round trip behind them. */
const CLIENT_ONLY_CODES = new Set(["NETWORK_ERROR", "REQUEST_TIMEOUT"]);

const BRANCHING_FILES = [
  "lib/session/login-error.ts",
  "features/auth/components/sign-in-form.tsx",
  "features/settings/components/use-change-email.ts",
  "features/settings/settings-helpers.ts",
];

function backendCodes(): Set<string> {
  const codes = new Set<string>();
  for (const file of [
    "features/auth/router.py",
    "features/auth/dependencies.py",
    "features/settings/router.py",
  ]) {
    const source = readFileSync(join(BACKEND, file), "utf8");
    // `http_error(status.HTTP_403_FORBIDDEN, "CODE", ...)` and the hand-built
    // `HTTPException(detail={"code": "CODE", ...})` the Retry-After paths use.
    for (const match of source.matchAll(
      /http_error\(\s*[^,]+,\s*"([A-Z_]+)"/g,
    )) {
      codes.add(match[1] ?? "");
    }
    for (const match of source.matchAll(/"code":\s*"([A-Z_]+)"/g)) {
      codes.add(match[1] ?? "");
    }
  }
  return codes;
}

function branchedCodes(): { code: string; where: string }[] {
  return BRANCHING_FILES.flatMap((file) => {
    const source = readFileSync(join(here, "..", file), "utf8");
    const found: { code: string; where: string }[] = [];
    // Only the shapes that decide behaviour: a switch arm, a `.code`
    // comparison, and a key in a code-to-message table.
    for (const pattern of [
      /case\s+"([A-Z_]+)"/g,
      /\.code\s*===\s*"([A-Z_]+)"/g,
      /^\s+([A-Z][A-Z_]{3,}):/gm,
    ]) {
      for (const match of source.matchAll(pattern)) {
        found.push({ code: match[1] ?? "", where: file });
      }
    }
    return found;
  });
}

describe("auth error codes", () => {
  it("finds the codes on both sides at all", () => {
    // Guard the scan's own signal: a regex that silently matches nothing
    // would make the assertion below pass vacuously.
    expect(backendCodes().size).toBeGreaterThan(10);
    expect(branchedCodes().length).toBeGreaterThan(10);
  });

  it("branches only on codes the API can send", () => {
    const emitted = backendCodes();
    const dead = branchedCodes()
      .filter(
        ({ code }) => !CLIENT_ONLY_CODES.has(code) && !emitted.has(code),
      )
      .map(({ code, where }) => `${where} branches on ${code}`);

    expect([...new Set(dead)]).toEqual([]);
  });
});
