import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE_DIRECTORIES = ["app", "components", "features", "lib"];
const SONNER_IMPORT_ALLOWLIST = new Set([
  "components/toast-host.tsx",
  "lib/core/hooks.ts",
]);
const GLOBAL_CSS = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

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

  it("keeps every toast white with shared navy text and aligned 15px titles", () => {
    for (const variant of ["success", "info", "warning", "error"]) {
      expect(GLOBAL_CSS).toContain(`--${variant}-bg: #ffffff`);
      expect(GLOBAL_CSS).toContain(`--${variant}-border: #cbd5e1`);
      expect(GLOBAL_CSS).toContain(`--${variant}-text: #00091a`);
    }

    expect(GLOBAL_CSS).toContain("font-size: 15px");
    expect(GLOBAL_CSS).toContain("line-height: 20px");
    expect(GLOBAL_CSS).toContain("background: #ffffff !important");
    expect(GLOBAL_CSS).toContain("color: #00091a !important");
    expect(GLOBAL_CSS).toContain("margin: 0 0 0 -3px !important");
  });

  it("uses warnings for local guidance and success for completed operations", () => {
    const settings = readFileSync(
      join(process.cwd(), "app/settings/page.tsx"),
      "utf8",
    );
    const playerCard = readFileSync(
      join(process.cwd(), "features/players/components/player-card.tsx"),
      "utf8",
    );

    expect(settings).toContain('toast.warning("Passwords do not match"');
    expect(settings).toContain('toast.warning("Check the Riot API key format"');
    expect(playerCard).toMatch(
      /title: "Update finished",[\s\S]*?variant: "success"/,
    );
  });
});
