// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { clearOptionalBrowserStorage } from "@/features/cookie-consent/utils/consent-storage";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("clearing optional storage when the browser refuses", () => {
  it("does not throw", () => {
    // A visitor with site data blocked makes every `localStorage` access throw,
    // and this runs in a mount effect above every error boundary. Stub the
    // getter, not `removeItem`: that is where the browser actually throws.
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("access denied", "SecurityError");
      },
    });

    try {
      expect(() => clearOptionalBrowserStorage()).not.toThrow();
    } finally {
      if (original) {
        Object.defineProperty(window, "localStorage", original);
      }
    }
  });
});
