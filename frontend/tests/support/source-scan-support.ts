import { readdirSync } from "node:fs";
import { extname, join } from "node:path";

/**
 * The directories the app ships from. `tests/` and `e2e/` are absent: a
 * contract test names the pattern it forbids, so it would flag itself.
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
 * Every source file a contract test is written against -- one list, because a
 * contract walking a narrower tree silently stops applying to the remainder.
 */
export function allSourceFiles(): string[] {
  return SOURCE_DIRECTORIES.flatMap(sourceFiles);
}

/**
 * Every `*.test.ts(x)` file, wherever it lives: wider than `allSourceFiles`,
 * so a test colocated beside its code still reaches suite-wide contracts.
 */
export function allTestFiles(): string[] {
  return ["tests", "e2e", ...SOURCE_DIRECTORIES]
    .flatMap(sourceFiles)
    .filter((path) => /\.test\.tsx?$/.test(path));
}
