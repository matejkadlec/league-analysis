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
      // Every source file, not just the ones a test happened to import.
      //
      // Vitest's default scope is "files the suite loaded", which made the
      // denominator a function of the tests themselves: `app/` was absent
      // entirely, so reverting all four blank-page shells -- the files this
      // branch exists to fix -- left the summary byte-identical, numerator
      // and denominator both. A file nobody tests was invisible rather than
      // zero, and no amount of ratcheting could ever reach it.
      // Extension-qualified: a bare `app/**` handed `components/CLAUDE.md` and
      // `components/AGENTS.md` to the parser, which printed a RolldownError
      // stack for each one and then excluded it. Harmless in itself, but it is
      // the same message a real source file would produce if it ever failed to
      // parse, and two guaranteed copies of it are how that one gets ignored.
      include: ["{app,components,features,lib}/**/*.{ts,tsx}", "proxy.ts"],
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
      // Measured 2026-08-19 over the scope above: 53.76% statements, 48.87%
      // branches, 50.00% functions, 54.12% lines. Lower than the 72/65/68/72
      // these read before, over ~900 more statements: same numerator, honest
      // denominator. Each floor sits ~2 points under its measurement, so
      // ratchet them up whenever coverage grows -- a floor that stops moving
      // stops catching anything, and now an untested new file moves it down.
      //
      // Ratcheted 2026-08-19 after the guard-quality loop: 69.19% statements,
      // 61.14% branches, 63.68% functions, 69.66% lines over 3,447 statements
      // and 452 tests. Left at 51/46/48/52 these had fallen ~18 points behind
      // and every test the loop added could have been deleted without the gate
      // saying anything -- which is precisely the failure the paragraph above
      // was written about, repeated by the branch that wrote it.
      thresholds: {
        statements: 67,
        branches: 59,
        functions: 61,
        lines: 67,
      },
    },
  },
});
