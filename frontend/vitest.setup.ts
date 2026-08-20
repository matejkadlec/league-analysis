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
