import { globSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The cookie policy promises a "Cookie settings" link in the footer, and both
 * shells have to keep it. `LegalNotice` takes the trigger as `children`, so
 * every call site decides separately -- the only form the promise can take.
 */

/** Every file that renders the shared legal footer. */
function legalNoticeCallSites(): string[] {
  return globSync("{app,components,features}/**/*.tsx").filter((path) => {
    const source = readFileSync(path, "utf8");
    // The definition itself is not a call site.
    return /<LegalNotice[\s>]/.test(source);
  });
}

describe("reopening cookie consent from the footer", () => {
  it("is offered by every footer that shows the legal notice", () => {
    const callSites = legalNoticeCallSites();

    // A rename that emptied this list would make the assertion below vacuous.
    expect(callSites.length).toBeGreaterThanOrEqual(2);

    const withoutTrigger = callSites.filter(
      (path) => !/<CookieSettingsTrigger[\s/>]/.test(readFileSync(path, "utf8")),
    );

    expect(withoutTrigger).toEqual([]);
  });
});
