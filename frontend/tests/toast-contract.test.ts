import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE_DIRECTORIES = ["app", "components", "features", "lib"];
const SONNER_IMPORT_ALLOWLIST = new Set([
  "components/toast-host.tsx",
  "lib/core/hooks.ts",
]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return [".ts", ".tsx"].includes(extname(entry.name)) ? [path] : [];
  });
}

describe("toast source contract", () => {
  it("routes Sonner usage through the shared typed adapter and host", () => {
    const directImports = SOURCE_DIRECTORIES.flatMap(sourceFiles)
      .filter((path) => readFileSync(path, "utf8").includes('from "sonner"'))
      .map((path) => relative(process.cwd(), path));

    expect(new Set(directImports)).toEqual(SONNER_IMPORT_ALLOWLIST);
  });

  it("does not use indefinite loading toasts", () => {
    const violations = SOURCE_DIRECTORIES.flatMap(sourceFiles).filter((path) =>
      /(?:toast|sonnerToast)\.loading/.test(readFileSync(path, "utf8")),
    );

    expect(violations).toEqual([]);
  });
});
