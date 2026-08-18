import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
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
 * A source contract rather than a behavioural test because the axios
 * interceptor is not reachable from any suite here: it lives on a
 * module-level instance, and re-adding the `removeAuthTokens()` this branch
 * deleted from it is green in every existing test.
 *
 * Two earlier versions of this file were defeated, and both times by the
 * same mistake: they described the teardown instead of owning it. Listing
 * files by hand missed every file nobody thought of. Matching the two helper
 * names missed a hand-rolled `document.cookie` delete — the worse version,
 * because it reports the visitor as signed out while their 30-day refresh
 * token stays live and spendable on the server. Matching the cookie name
 * missed the template literal, the concatenation, and the variable holding
 * the string.
 *
 * So the rule here is not a description of a teardown. It is: writing a
 * cookie, and importing the teardown helpers, are things only these files
 * may do at all. There is no spelling to get around, because the rule does
 * not care what is being written.
 */
const SOURCE_DIRECTORIES = ["app", "components", "features", "lib"];
// `proxy.ts` routes on the hint cookie alone, so a teardown there would be
// the most consequential in the codebase — and a walk that starts below the
// root never sees it.
const ROOT_SOURCES = ["proxy.ts"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

/** May decide that a session is over. */
const TEARDOWN_OWNERS = new Set([
  // Owns the rejected-versus-unreachable distinction.
  "features/auth/utils/token-manager.ts",
  // The explicit user action, after the server has been asked to revoke,
  // plus the two probe outcomes that are rejections rather than blips.
  "features/auth/context/auth-context.tsx",
  // Declares `clearAuthStateCookie`. Naming it here is defining it, not
  // deciding to call it.
  "features/auth/utils/auth-state-cookie.ts",
]);

/** May write a cookie from the browser. */
const COOKIE_WRITERS = new Set([
  // Performs the delete `token-manager` asks for; decides nothing itself.
  "features/auth/utils/auth-state-cookie.ts",
  // An unrelated cookie, and not a credential.
  "features/cookie-consent/utils/consent-storage.ts",
]);

const IMPORTS_A_TEARDOWN = /\b(removeAuthTokens|clearAuthStateCookie)\b/;
const WRITES_A_COOKIE = /(?:document|cookieStore)\s*\.\s*cookie\s*=[^=]/;
// The server-side equivalent, which carries no `document` and no helper name.
const WRITES_A_COOKIE_ON_THE_SERVER =
  /\bcookies\s*(?:\([^)]*\))?\s*\.\s*(?:set|delete)\s*\(/;

/** Comments describe teardowns; only code performs them. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

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
  const byDirectory = new Map(
    SOURCE_DIRECTORIES.map((directory) => [directory, sourceFiles(directory)]),
  );
  const files = [...[...byDirectory.values()].flat(), ...ROOT_SOURCES];

  it("scans the whole source tree, not a list someone has to remember", () => {
    // A count alone is a weak floor: dropping a whole directory still clears
    // any threshold the rest of the tree passes on its own. Each configured
    // directory has to actually contribute.
    for (const [directory, found] of byDirectory) {
      expect(found.length, `${directory} contributed no files`).toBeGreaterThan(
        0,
      );
    }
    expect(files).toContain("lib/core/api.ts");
    expect(files).toContain("components/providers.tsx");
    // Routes on the hint alone, and sits above every scanned directory.
    expect(files).toContain("proxy.ts");
  });

  it.each(files)("%s", (relativePath) => {
    const source = withoutComments(
      readFileSync(join(process.cwd(), relativePath), "utf8"),
    );

    expect(
      !TEARDOWN_OWNERS.has(relativePath) && IMPORTS_A_TEARDOWN.test(source),
      `${relativePath} names a teardown helper, but cannot tell a rejected session from an unreachable server. Renaming it on import does not change that.`,
    ).toBe(false);

    expect(
      !COOKIE_WRITERS.has(relativePath) &&
        (WRITES_A_COOKIE.test(source) ||
          WRITES_A_COOKIE_ON_THE_SERVER.test(source)),
      `${relativePath} writes a cookie. Deleting the session hint by hand reports the visitor as signed out while their refresh token stays live on the server, so the write belongs in a file that owns it.`,
    ).toBe(false);
  });
});
