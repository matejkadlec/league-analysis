import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Only the refresh call may give up on a session.
 *
 * `refreshAccessToken` is the one place that can tell a rejected session
 * (401/403) from a server it could not reach (502, timeout, offline). Every
 * other caller sees the same failed request either way, so a teardown from
 * anywhere else signs people out over a redeploy or a dropped connection,
 * with a valid refresh cookie still in the jar and the hint gone that would
 * have let it be used.
 *
 * This is a source contract rather than a behavioural test because the
 * interceptor is not reachable from any suite here: it lives on a module-level
 * axios instance, and re-adding the `removeAuthTokens()` this branch deleted
 * from it is green in every existing test.
 */
const ALLOWED_TEARDOWN_CALLERS = new Set([
  // Owns the distinction, and is where the teardown belongs.
  "features/auth/utils/token-manager.ts",
  // The explicit user action, after the server has been asked to revoke,
  // plus the two probe outcomes that are rejections rather than blips.
  "features/auth/context/auth-context.tsx",
]);

const SCANNED = [
  "lib/core/api.ts",
  "features/auth/utils/token-manager.ts",
  "features/auth/context/auth-context.tsx",
  "features/auth/components/protected-route.tsx",
  "components/auth-gate.tsx",
];

describe("who may end a session", () => {
  it.each(SCANNED)("%s", (relativePath) => {
    const source = readFileSync(
      join(process.cwd(), relativePath),
      "utf8",
    );
    const tearsDown =
      /\bremoveAuthTokens\s*\(/.test(source) ||
      /\bclearAuthStateCookie\s*\(/.test(source);

    expect(
      tearsDown && !ALLOWED_TEARDOWN_CALLERS.has(relativePath),
      `${relativePath} tears the session down, but cannot tell a rejected session from an unreachable server`,
    ).toBe(false);
  });
});
