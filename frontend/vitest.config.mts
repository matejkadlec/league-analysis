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
    // A test that stubs an env var and then fails an assertion never reaches
    // its own cleanup line, so the stub leaks into every test after it and
    // buries the original failure under a cascade of unrelated ones.
    unstubEnvs: true,
    // The same reasoning as `unstubEnvs`, for the other two things a failing
    // test walks out on. Two files stub a global with no `unstubAllGlobals`,
    // which is harmless only while every file is isolated.
    unstubGlobals: true,
    restoreMocks: true,
    // Vitest's default 5000ms is the exact value `vitest.setup.ts` gives
    // `asyncUtilTimeout`, so the test's own timer always won and several
    // sequential `waitFor` calls shared one 5s budget between them.
    testTimeout: 20_000,
    // The gap `house/meaningful-tests` declares out of scope in its own header:
    // it reads matchers, so a test with no matcher at all is invisible to it.
    // This fails one instead, and measured zero fallout across 1038 tests.
    expect: { requireAssertions: true },
    // Proven before pinning: the suite passes shuffled (seed 424242, 1045
    // tests). Vitest prints `Running tests with seed "N"`, so reproduce a red
    // run with `npm test -- --sequence.seed=N`; unseeded it is `Date.now()`.
    sequence: { shuffle: true },
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      // Every source file, not just the ones a test loaded: the default scope
      // makes the denominator a function of the tests, so an untested file is
      // invisible rather than zero. The two root `instrumentation*.ts` were.
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
      // Measured 2026-08-31: statements 92.22, branches 86.83, functions
      // 88.80, lines 92.32. Labelled deliberately -- reading an unlabelled
      // `92.19/86.80/88.80/92.29` by position is what invented the drift.
      thresholds: {
        // Reproducible to the byte: 11 runs -- 4 seeds on the host, 4 seeded
        // and 3 unseeded in the gate container -- agreed per file. Nothing
        // moves these but a code change, so they sit just under. Ratchet them.
        statements: 92,
        branches: 86,
        functions: 88,
        lines: 92,
      },
    },
  },
});
