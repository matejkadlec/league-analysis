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

  it("keeps semantic pale surfaces, matching borders, and shared navy text", () => {
    const colors = {
      success: { background: "#f0fdf4", accent: "#166534" },
      warning: { background: "#fffbeb", accent: "#854d0e" },
      error: { background: "#fef2f2", accent: "#991b1b" },
      info: { background: "#eff6ff", accent: "#1e3a8a" },
    };

    for (const [variant, color] of Object.entries(colors)) {
      expect(GLOBAL_CSS).toContain(`--${variant}-bg: ${color.background}`);
      expect(GLOBAL_CSS).toContain(`--${variant}-border: ${color.accent}`);
      expect(GLOBAL_CSS).toContain(
        `background: ${color.background} !important`,
      );
      expect(GLOBAL_CSS).toContain(
        `border: 1px solid ${color.accent} !important`,
      );
      expect(GLOBAL_CSS).toContain(`--${variant}-text: #00091a`);
    }

    expect(GLOBAL_CSS).toContain("padding: 12px !important");
    expect(GLOBAL_CSS).toContain("gap: 6px !important");
    expect(GLOBAL_CSS).toContain("font-size: 15px");
    expect(GLOBAL_CSS).toContain("line-height: 20px");
    expect(GLOBAL_CSS).toContain("color: #00091a !important");
    expect(GLOBAL_CSS).toContain("margin: 0 0 0 -3px !important");
    expect(GLOBAL_CSS).toContain("right: 5px !important");
    expect(GLOBAL_CSS).toContain("top: 5px !important");
    expect(GLOBAL_CSS).toContain("transform: scale(1.15)");
  });

  it("uses warnings for local guidance and success for completed operations", () => {
    const settingsDir = join(process.cwd(), "app/settings");
    const settings = readdirSync(settingsDir)
      .filter((name) => name.endsWith(".ts") || name.endsWith(".tsx"))
      .map((name) => readFileSync(join(settingsDir, name), "utf8"))
      .join("\n");
    const playerSyncRun = readFileSync(
      join(process.cwd(), "features/players/use-player-sync-run.ts"),
      "utf8",
    );

    expect(settings).toContain('toast.warning("Passwords do not match"');
    expect(settings).toContain('toast.warning("Check the Riot API key format"');
    expect(playerSyncRun).toContain('toast.success("Update finished"');
  });
});
