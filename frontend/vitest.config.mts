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
    // Restore `vi.stubEnv` after every test rather than trusting each one to
    // unstub itself. A test that stubs an environment variable and then fails
    // an assertion never reaches its own cleanup line, so the stub survives
    // into every test after it and buries the original failure under a cascade
    // of unrelated ones.
    unstubEnvs: true,
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
      // Floors, not targets, and they only mean anything while they track
      // the measurement. Left at their 2026-08-16 values they fell ~11 points
      // behind: deleting the eleven session test files -- 40% of the suite,
      // taking token-manager.ts from 95% statements to 6% and its branches to
      // zero -- still cleared every floor, so the stage said nothing about
      // the work this branch exists for.
      //
      // Measured 2026-08-19 on the default scope (the files the suite
      // actually imports): 72.60% statements, 65.62% branches, 68.33%
      // functions, 72.91% lines. Each floor sits ~3 points under its
      // measurement, so ratchet these up whenever coverage grows -- a floor
      // that stops moving stops catching anything.
      thresholds: {
        statements: 69,
        branches: 62,
        functions: 65,
        lines: 69,
      },
    },
  },
});
