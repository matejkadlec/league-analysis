import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // 60s, because 11 tests across 5 specs already opened with
  // `test.setTimeout(60_000)` -- the config value was overridden more often
  // than obeyed. Those 11 lines are gone now that it says what the suite needs.
  timeout: 60_000,
  expect: {
    // The default is 5s against tests budgeted at 60s, so a web-first
    // assertion gave up long before the test did, and two call sites already
    // passed `timeout:` inline to work around it.
    timeout: 10_000,
  },
  // `test.sh` passes `--forbid-only`, which protects that one call site;
  // `npm run test:e2e` run by hand -- where a stray `.only` is actually
  // written -- was unguarded, and `.only` skips the whole rest of the run.
  forbidOnly: true,
  // One retry, and keep the evidence: a flaky spec on the shared Pi runner
  // produced a stack line and nothing else. `.gitignore` already reserves both
  // output directories, and the gate bind-mounts the repo.
  retries: 1,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:3100",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: {
    // The production build, not `next dev`: under the dev server these specs
    // hit a hydration mismatch production never sees. Needs `npm run build`
    // first, which is the order test.sh uses.
    command: "npm run start:standalone",
    env: {
      // Only reaches routes that stay dynamic; prerendered ones baked their
      // version in at build time, so test.sh pins the build too -- keep the
      // two in step. `blockUpstreamRequests` cannot: that fetch is server-side.
      DDRAGON_VERSION: "16.15.1",
      // Keep in step with `run_frontend_build` in test.sh.
      NEXT_DEPLOYMENT_ID: "gate-local",
      HOSTNAME: "127.0.0.1",
      PORT: "3100",
    },
    // Never reuse. `test.sh` always builds fresh and always wants its own
    // server; `!process.env.CI` was inert on the host path, where it adopted a
    // leftover `start:standalone` and graded a stale `.next/standalone`.
    reuseExistingServer: false,
    timeout: 120_000,
    url: "http://127.0.0.1:3100",
  },
});
