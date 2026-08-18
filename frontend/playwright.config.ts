import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:3100",
    browserName: "chromium",
  },
  webServer: {
    // The production build, not `next dev`. Under the dev server these specs
    // hit a hydration mismatch that production never sees: compiling on first
    // visit stretches the initial load, and once the icon requests stop going
    // to the network — which is the point of `blockUpstreamRequests` — the
    // page loads fast enough to start hydrating before what it hydrates
    // against has settled. React then throws away the server HTML and
    // re-renders the tree, which is not a state any assertion should be
    // measuring. Serving what actually ships removes it, and halves the
    // suite's runtime as a side effect.
    //
    // This needs `npm run build` to have run first, which is the order
    // test.sh uses. Locally: `npm run build && npm run test:e2e`.
    command: "npm run start:standalone",
    env: {
      NEXT_PUBLIC_API_URL: "http://127.0.0.1:3100",
      // The layout resolves this from Riot's CDN when it is unset, which is a
      // public-internet dependency the gate should not carry — and a version
      // that changes under the suite. `blockUpstreamRequests` cannot stop it:
      // the fetch is server-side.
      DDRAGON_VERSION: "16.15.1",
      HOSTNAME: "127.0.0.1",
      PORT: "3100",
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    url: "http://127.0.0.1:3100",
  },
});
