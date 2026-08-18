// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { clearOptionalBrowserStorage } from "@/features/cookie-consent/utils/consent-storage";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("clearing optional storage when the browser refuses", () => {
  it("does not throw", () => {
    // A visitor with site data blocked makes every `localStorage` access
    // throw a SecurityError. This runs in a mount effect in
    // `CookieConsentManager`, which sits above every error boundary, so an
    // unguarded throw unmounts the whole tree and hands them a blank page --
    // the same symptom as the bug this branch exists to remove, from a
    // completely unrelated cause.
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("access denied", "SecurityError");
    });

    expect(() => clearOptionalBrowserStorage()).not.toThrow();
  });
});
