import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // 60s is what the suite needs; specs used to override this with their own
  // `test.setTimeout(60_000)`.
  timeout: 60_000,
  expect: {
    // The default 5s makes a web-first assertion give up long before a test
    // budgeted at 60s does.
    timeout: 10_000,
  },
  // A stray `.only` skips the rest of the run, and `npm run test:e2e` by hand
  // gets no `--forbid-only` from `test.sh`.
  forbidOnly: true,
  // One retry, with artifacts kept: a flake on the shared Pi runner otherwise
  // leaves a stack line and nothing else.
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
    // The production build, not `next dev`: the dev server hits a hydration
    // mismatch production never sees, so `npm run build` has to run first.
    command: "npm run start:standalone",
    env: {
      // Only reaches dynamic routes; prerendered pages bake it in at build
      // time, so test.sh pins the build too. `blockUpstreamRequests` can't help: that fetch is server-side.
      DDRAGON_VERSION: "16.15.1",
      // Keep in step with `run_frontend_build` in test.sh.
      NEXT_DEPLOYMENT_ID: "gate-local",
      HOSTNAME: "127.0.0.1",
      PORT: "3100",
    },
    // Never reuse: adopting a leftover `start:standalone` grades a stale
    // `.next/standalone` against a fresh build.
    reuseExistingServer: false,
    timeout: 120_000,
    url: "http://127.0.0.1:3100",
  },
});
