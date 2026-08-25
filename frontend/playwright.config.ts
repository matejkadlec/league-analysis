import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:3100",
    browserName: "chromium",
  },
  webServer: {
    // The production build, not `next dev`: under the dev server these specs
    // hit a hydration mismatch production never sees. Needs `npm run build`
    // first, which is the order test.sh uses.
    command: "npm run start:standalone",
    env: {
      // Only reaches the routes that stay dynamic; prerendered ones baked
      // their version in at build time, so test.sh pins the build too -- keep
      // the two in step. `blockUpstreamRequests` cannot substitute, because
      // the unpinned fetch to Riot's CDN is server-side.
      DDRAGON_VERSION: "16.15.1",
      // Keep in step with `run_frontend_build` in test.sh.
      NEXT_DEPLOYMENT_ID: "gate-local",
      HOSTNAME: "127.0.0.1",
      PORT: "3100",
    },
    // Never reuse. `test.sh` always builds fresh and always wants its own
    // server, and `!process.env.CI` was inert where it mattered: on the host
    // path it silently adopted a leftover `start:standalone` and graded a
    // stale `.next/standalone`.
    reuseExistingServer: false,
    timeout: 120_000,
    url: "http://127.0.0.1:3100",
  },
});
