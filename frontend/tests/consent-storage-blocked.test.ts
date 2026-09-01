// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { clearOptionalBrowserStorage } from "@/features/cookie-consent/consent-storage";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("clearing optional storage when the browser refuses", () => {
  it("does not throw", () => {
    // Stub the getter, not `removeItem`: with site data blocked that is where
    // the browser actually throws, above every error boundary.
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
