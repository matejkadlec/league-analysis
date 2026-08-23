import { globSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The cookie policy makes a promise about the footer, and both shells have to keep it.
 *
 * `app/cookie-policy/page.tsx` tells every reader they can reopen the consent
 * dialog "using the **Cookie settings** link in the page footer". That
 * sentence is not scoped to signed-out visitors, and the page renders inside
 * whichever shell the reader is in.
 *
 * LGA-85 was raised because the copy named a control that did not exist, and
 * `8ac13a9` fixed it -- for the public footer only. The signed-in shell's
 * footer still rendered `LegalNotice` with no trigger, so an authenticated
 * reader was looking at a sentence naming a link that was not on their page.
 * A source read could not show this; it took loading the page with a session.
 *
 * `LegalNotice` takes the trigger as `children`, so "which footers offer it"
 * is decided at each call site. This asserts every call site decides the same
 * way, which is the only form the promise can take.
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

  it("is the control the cookie policy actually names", () => {
    // If the copy is ever reworded away from the footer, the invariant above
    // stops being the right one -- so it is pinned to the sentence it serves.
    const policy = readFileSync("app/cookie-policy/page.tsx", "utf8");

    expect(policy.replace(/\s+/g, " ")).toContain(
      "<strong>Cookie settings</strong> link in the page footer",
    );
  });
});
