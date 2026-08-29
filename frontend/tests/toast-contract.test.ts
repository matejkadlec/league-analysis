import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";

import { allSourceFiles } from "./support/source-scan-support";

const SONNER_IMPORT_ALLOWLIST = new Set([
  "components/toast-host.tsx",
  "lib/core/hooks/index.ts",
]);

describe("toast source contract", () => {
  it("routes Sonner usage through the shared typed adapter and host", () => {
    const directImports = allSourceFiles()
      .filter((path) => readFileSync(path, "utf8").includes('from "sonner"'))
      .map((path) => relative(process.cwd(), path));

    expect(new Set(directImports)).toEqual(SONNER_IMPORT_ALLOWLIST);
  });

  it("does not use indefinite loading toasts", () => {
    const violations = allSourceFiles().filter((path) =>
      /(?:toast|sonnerToast)\.loading/.test(readFileSync(path, "utf8")),
    );

    expect(violations).toEqual([]);
  });
});
