import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { AUTH_STATE_COOKIE_NAME } from "@/features/auth/utils/auth-state-cookie";

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
 * A source contract rather than a behavioural test because the axios
 * interceptor is not reachable from any suite here: it lives on a
 * module-level instance, and re-adding the `removeAuthTokens()` this branch
 * deleted from it is green in every existing test.
 *
 * Two things this has to catch, and an earlier version of it caught neither.
 * A teardown can hide in a file nobody thought to list, so the whole source
 * tree is scanned rather than a handful of paths. And it can be written
 * without naming either helper: deleting the hint cookie by hand is the same
 * act, and worse, because it reports someone as signed out while their
 * 30-day refresh token stays live and spendable on the server.
 */
const SOURCE_DIRECTORIES = ["app", "components", "features", "lib"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

const TEARDOWN_OWNERS = new Set([
  // Owns the rejected-versus-unreachable distinction, and is where the
  // teardown belongs.
  "features/auth/utils/token-manager.ts",
  // The explicit user action, after the server has been asked to revoke,
  // plus the two probe outcomes that are rejections rather than blips.
  "features/auth/context/auth-context.tsx",
  // Defines the delete that `token-manager` calls; writes no policy itself.
  "features/auth/utils/auth-state-cookie.ts",
]);

const CALLS_A_TEARDOWN_HELPER =
  /\b(removeAuthTokens|clearAuthStateCookie)\s*\(/;
// A hand-rolled expiry of the hint: any `document.cookie` assignment naming
// the hint with a zeroed lifetime.
const EXPIRES_THE_HINT_BY_HAND = new RegExp(
  String.raw`document\.cookie\s*=[^;]*${AUTH_STATE_COOKIE_NAME}[^"'\`]*(max-age\s*=\s*0|expires\s*=)`,
  "i",
);

function sourceFiles(directory: string): string[] {
  const root = join(process.cwd(), directory);
  const found: string[] = [];

  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") {
          walk(full);
        }
      } else if (SOURCE_EXTENSIONS.has(extname(entry.name))) {
        found.push(relative(process.cwd(), full));
      }
    }
  };

  walk(root);
  return found;
}

describe("who may end a session", () => {
  const files = SOURCE_DIRECTORIES.flatMap(sourceFiles);

  it("scans the whole source tree, not a list someone has to remember", () => {
    // The previous version listed five paths, so a teardown added anywhere
    // else was invisible.
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain("lib/core/api.ts");
    expect(files).toContain("components/providers.tsx");
  });

  it.each(files)("%s", (relativePath) => {
    const source = readFileSync(join(process.cwd(), relativePath), "utf8");
    const owns = TEARDOWN_OWNERS.has(relativePath);

    expect(
      !owns && CALLS_A_TEARDOWN_HELPER.test(source),
      `${relativePath} tears the session down, but cannot tell a rejected session from an unreachable server`,
    ).toBe(false);

    expect(
      !owns && EXPIRES_THE_HINT_BY_HAND.test(source),
      `${relativePath} expires the session hint by hand, which reports the visitor as signed out while their refresh token stays live on the server`,
    ).toBe(false);
  });
});
