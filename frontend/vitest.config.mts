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
    setupFiles: ["./vitest.setup.ts"],
    // A failing test never reaches its own cleanup line, so an env stub leaks
    // into every test after it and buries the original failure.
    unstubEnvs: true,
    // As `unstubEnvs`: files stub globals without `unstubAllGlobals`, which is
    // harmless only while every file stays isolated.
    unstubGlobals: true,
    restoreMocks: true,
    // Above `vitest.setup.ts`'s 5000ms `asyncUtilTimeout`: at equal values the
    // test timer wins and sequential `waitFor` calls share one budget.
    testTimeout: 20_000,
    // `house/meaningful-tests` reads matchers, so a test with no matcher at
    // all is invisible to it; this fails one instead.
    expect: { requireAssertions: true },
    // Reproduce a red run with `npm test -- --sequence.seed=N`, taking N from
    // Vitest's `Running tests with seed "N"` line.
    sequence: { shuffle: true },
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      // Every source file, not just the ones a test loaded: the default scope
      // makes an untested file invisible rather than zero.
      include: [
        "{app,components,features,lib}/**/*.{ts,tsx}",
        "proxy.ts",
        "instrumentation.ts",
        "instrumentation-client.ts",
      ],
      exclude: [
        ...(configDefaults.coverage.exclude ?? []),
        "e2e/**",
        "tests/**",
        "**/*.config.*",
        "next-env.d.ts",
      ],
      // Measured: statements 92.22, branches 86.83, functions 88.80, lines
      // 92.32. Labelled -- reading four bare numbers by position invents drift.
      thresholds: {
        // Nothing but a code change moves these, so they sit just under the
        // measured figures. Ratchet them.
        statements: 92,
        branches: 86,
        functions: 88,
        lines: 92,
      },
    },
  },
});
