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
      // Ratcheted again at the end of the same sweep: 73.62% statements,
      // 66.42% branches, 68.21% functions, 73.80% lines over 493 tests, after
      // the zero-covered class was closed. Ratchet on the way out of a batch
      // of work, not once per file -- but do ratchet, or the floors drift
      // eighteen points behind again the way they just did.
      // Ratcheted 2026-08-19 on the way out of the next batch: 78.50%
      // statements, 72.02% branches, 72.96% functions, 78.63% lines over 561
      // tests, after `match-row.tsx` (1.33% → 97.33%), `lib/core/api.ts`
      // (49.18% → 98.36%) and `use-job-card-controls.ts` (38.81% → 78.94%).
      // Ratcheted 2026-08-19 once more, closing the under-20% band: 82.94%
      // statements, 77.33% branches, 79.29% functions, 83.15% lines over 626
      // tests. Nothing with ≥10 statements now sits below 20% except the two
      // route shells the ledger already resolved.
      // Ratcheted 2026-08-20 after a deletion sweep rather than a test sweep:
      // 83.74% statements, 78.27% branches, 80.62% functions, 83.84% lines
      // over the same 658 tests. Nothing was covered that was not covered
      // before -- roughly 620 lines of unreachable source left the
      // denominator, which is the one way coverage rises without anyone
      // writing a test. Ratcheting matters more after this kind of batch than
      // after a testing one: leave the floors where they were and the deleted
      // code's absence silently buys headroom for the next untested file.
      thresholds: {
        statements: 81,
        branches: 76,
        functions: 78,
        lines: 81,
      },
    },
  },
});
