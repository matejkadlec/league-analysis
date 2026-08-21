import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { allSourceFiles } from "./source-scan-support";

const SONNER_IMPORT_ALLOWLIST = new Set([
  "components/toast-host.tsx",
  "lib/core/hooks.ts",
]);
const GLOBAL_CSS = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

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
    const settingsDir = join(process.cwd(), "features/settings");
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
