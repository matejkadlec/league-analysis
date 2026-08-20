import { configure } from "@testing-library/dom";

// jsdom implements no CSS engine and therefore no `window.matchMedia`, so any
// component reading a breakpoint throws on render. Stub it once here rather
// than in each suite: the default answer is "does not match", which is the
// same server snapshot `useMediaQuery` takes, so components render their
// baseline (mobile-first) branch unless a test says otherwise.
//
// To exercise the matched branch, override `window.matchMedia` in that test.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// Testing Library retries `findBy*`/`waitFor` for 1000ms by default, which is
// a statement about how fast the machine is rather than about the component.
// The CI runner is a single shared aarch64 Pi that builds containers in the
// same job, and there individual tests measured 1.8s where they take under
// 100ms locally. A component that has to resolve a React Query fetch before it
// can render its settled state loses that race, and the failure reads as a
// missing element rather than as a timeout: `track-player-button` failed the
// gate still showing its spinner, asserting against a button that was simply
// not finished yet.
//
// Five seconds costs nothing when a test passes -- the timeout only bounds how
// long a *failing* query waits -- and it removes the whole class of CI-only
// flakes that a re-run would have papered over.
configure({ asyncUtilTimeout: 5000 });
