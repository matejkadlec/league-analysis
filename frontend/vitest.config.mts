import { configDefaults, defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    exclude: [...configDefaults.exclude, "e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      exclude: [
        ...(configDefaults.coverage.exclude ?? []),
        "e2e/**",
        "tests/**",
        "**/*.config.*",
        "next-env.d.ts",
      ],
      // Floors, not targets. Measured 2026-08-16 on the default scope (the
      // files the suite actually imports): 61.78% statements, 55.09%
      // branches, 59.61% functions, 62.12% lines. Each floor sits ~3 points
      // under its measurement so the gate passes today and can be ratcheted
      // up as coverage grows.
      thresholds: {
        statements: 58,
        branches: 52,
        functions: 56,
        lines: 59,
      },
    },
  },
});
