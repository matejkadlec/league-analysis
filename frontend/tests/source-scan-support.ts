import { readdirSync } from "node:fs";
import { extname, join } from "node:path";

/**
 * The directories the app ships from, which the contract tests read.
 *
 * `tests/` and `e2e/` are absent on purpose: a contract test names the pattern
 * it forbids in order to search for it, so scanning itself would report the
 * check as a violation.
 */
const SOURCE_DIRECTORIES = ["app", "components", "features", "lib"];

/** Every `.ts`/`.tsx` file under `directory`, recursively. */
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return [".ts", ".tsx"].includes(extname(entry.name)) ? [path] : [];
  });
}

/**
 * Every source file a contract test is written against.
 *
 * One list for all of them: a contract that walks a narrower tree than its
 * siblings silently stops applying to whatever it left out, and nothing says
 * so.
 */
export function allSourceFiles(): string[] {
  return SOURCE_DIRECTORIES.flatMap(sourceFiles);
}
