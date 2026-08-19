// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  COOKIE_CONSENT_COOKIE_NAME,
  COOKIE_CONSENT_MAX_AGE_SECONDS,
  COOKIE_CONSENT_VERSION,
  canUseOptionalStorage,
  readCookieConsentFromBrowser,
  writeCookieConsent,
} from "../features/cookie-consent/utils/consent-storage";

function setConsentCookie(value: string) {
  document.cookie = `${COOKIE_CONSENT_COOKIE_NAME}=${encodeURIComponent(value)}; path=/`;
}

afterEach(() => {
  document.cookie = `${COOKIE_CONSENT_COOKIE_NAME}=; max-age=0; path=/`;
  vi.restoreAllMocks();
});

describe("what counts as consent", () => {
  it("does not honour a consent given against an older version", () => {
    // The only reason `COOKIE_CONSENT_VERSION` exists: when what we ask for
    // changes, the previous answer stops counting and the banner asks again.
    // Dropping `isCurrentCookieConsent` from this check kept all 356 tests
    // green, and it silently converts every stale "accept all" in the wild
    // into consent for terms its owner never saw.
    expect(
      canUseOptionalStorage({
        level: "all",
        version: "v0",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toBe(false);

    expect(
      canUseOptionalStorage({
        level: "all",
        version: COOKIE_CONSENT_VERSION,
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toBe(true);
  });

  it.each([
    ["a level this app never issues", "v1|maybe|2026-01-01T00:00:00.000Z"],
    ["a timestamp that is not a date", "v1|all|whenever"],
    ["no timestamp at all", "v1|all|"],
    ["nothing but separators", "||"],
  ])("refuses a consent cookie carrying %s", (_label, raw) => {
    // A consent cookie is visitor-writable and outlives releases, so it is
    // read the way any untrusted input is read. Every rejection branch in the
    // parser was unexercised: removing them left the suite green while a
    // hand-edited cookie became a `CookieConsentState` the rest of the app
    // trusts.
    setConsentCookie(raw);

    expect(readCookieConsentFromBrowser()).toBeNull();
  });

  it("writes a consent cookie that survives a round trip, with its attributes", () => {
    // jsdom hands back only `name=value` when reading `document.cookie`, so
    // the attributes are asserted at the point of writing. Without that,
    // dropping `SameSite=Lax` -- or the six-month `Max-Age`, which is what
    // makes the answer persist instead of being asked on every visit -- passes
    // every other test in the suite.
    const writes: string[] = [];
    vi.spyOn(document, "cookie", "set").mockImplementation((value: string) => {
      writes.push(value);
    });

    const written = writeCookieConsent("all");

    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("Path=/");
    expect(writes[0]).toContain("SameSite=Lax");
    expect(writes[0]).toContain(`Max-Age=${COOKIE_CONSENT_MAX_AGE_SECONDS}`);
    expect(written.version).toBe(COOKIE_CONSENT_VERSION);

    vi.restoreAllMocks();
    setConsentCookie(`${written.version}|${written.level}|${written.updatedAt}`);
    expect(readCookieConsentFromBrowser()).toEqual(written);
  });
});
