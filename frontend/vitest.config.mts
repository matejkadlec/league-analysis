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
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      // Every source file, not just the ones a test loaded: the default scope
      // makes the denominator a function of the tests, so an untested file is
      // invisible rather than zero. Extension-qualified so the parser is never
      // handed a `.md`.
      include: ["{app,components,features,lib}/**/*.{ts,tsx}", "proxy.ts"],
      exclude: [
        ...(configDefaults.coverage.exclude ?? []),
        "e2e/**",
        "tests/**",
        "**/*.config.*",
        "next-env.d.ts",
      ],
      // Floors, not targets: each sits ~2 points under the last measurement
      // (2026-08-20: 83.74/78.27/80.62/83.84). Ratchet on the way out of every
      // batch, deletion sweeps included -- a floor left behind stops catching
      // anything and silently buys headroom.
      thresholds: {
        statements: 81,
        branches: 76,
        functions: 78,
        lines: 81,
      },
    },
  },
});
