import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:3100",
    browserName: "chromium",
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3100",
    env: {
      NEXT_PUBLIC_API_URL: "http://127.0.0.1:3100",
      // The layout resolves this from Riot's CDN when it is unset, which is a
      // public-internet dependency the gate should not carry — and a version
      // that changes under the suite. `blockUpstreamRequests` cannot stop it:
      // the fetch is server-side.
      DDRAGON_VERSION: "16.15.1",
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    url: "http://127.0.0.1:3100",
  },
});
