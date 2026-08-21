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
      // Only reaches the routes that stay dynamic. Every prerendered route
      // baked its version in at build time, which is why test.sh pins the
      // build as well — keep the two values in step. Unpinned, the layout
      // resolves this from Riot's CDN, which is both a public-internet
      // dependency the gate should not carry and a version that changes under
      // the suite. `blockUpstreamRequests` cannot stop it: the fetch is
      // server-side.
      DDRAGON_VERSION: "16.15.1",
      HOSTNAME: "127.0.0.1",
      PORT: "3100",
    },
    // Never reuse. `!process.env.CI` was inert where it mattered -- the gate
    // container has no CI variable and nothing else bound to 3100 -- while on
    // the host path (`./test.sh -f`) it silently adopted a leftover
    // `start:standalone` from an aborted run and graded a stale
    // `.next/standalone`. `test.sh` always builds fresh and always wants its
    // own server, so there is no case where reuse is the right answer.
    reuseExistingServer: false,
    timeout: 120_000,
    url: "http://127.0.0.1:3100",
  },
});
