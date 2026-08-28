// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CookieSettingsTrigger } from "@/components/cookie-settings-trigger";
import { LegalNotice } from "@/components/legal-notice";
// The barrel does not re-export the event name; the manager reads it from
// here too, which is the pairing this test exists to hold together.
import { COOKIE_CONSENT_OPEN_PREFERENCES_EVENT } from "@/features/cookie-consent/utils/consent-storage";
import { LEGAL_PAGES } from "@/lib/core/legal-pages";

/**
 * `legal-page-shell.test.tsx` asserts both of these are present; neither its
 * separator arithmetic nor the trigger's click has ever been exercised.
 */

afterEach(() => {
  cleanup();
});

function separators(): number {
  return (screen.getByRole("paragraph").textContent?.match(/\|/g) ?? []).length;
}

describe("LegalNotice", () => {
  it("links every legal page, from the one list the sitemap also reads", () => {
    render(<LegalNotice />);

    for (const page of LEGAL_PAGES) {
      const link = screen.getByRole("link", { name: page.label });
      expect(link.getAttribute("href")).toBe(page.href);
    }
    expect(screen.getAllByRole("link")).toHaveLength(LEGAL_PAGES.length);
  });

  it("separates the links without a leading or trailing bar", () => {
    // `index > 0` is the whole rule: an unguarded separator opens the line
    // with a stray "|".
    render(<LegalNotice />);

    expect(separators()).toBe(LEGAL_PAGES.length - 1);
    expect(screen.getByRole("paragraph").textContent).not.toMatch(/\|\s*$/);
  });

  it("puts children behind the same separator, and only when there are any", () => {
    render(<LegalNotice>extra</LegalNotice>);

    expect(separators()).toBe(LEGAL_PAGES.length);
    expect(screen.getByRole("paragraph").textContent).toContain("| extra");
  });
});

describe("CookieSettingsTrigger", () => {
  it("announces the reopen request the consent manager listens for", async () => {
    // The footer link is the only way back to the dialog once it is answered,
    // and the manager hears it only as this window event. Unmocked on
    // purpose: a mocked module would pass while the event name drifted.
    const user = userEvent.setup();
    const heard: string[] = [];
    const listen = () => heard.push(COOKIE_CONSENT_OPEN_PREFERENCES_EVENT);
    window.addEventListener(COOKIE_CONSENT_OPEN_PREFERENCES_EVENT, listen);
    render(<CookieSettingsTrigger />);

    await user.click(screen.getByRole("button", { name: "Cookie settings" }));
    window.removeEventListener(COOKIE_CONSENT_OPEN_PREFERENCES_EVENT, listen);

    expect(heard).toEqual([COOKIE_CONSENT_OPEN_PREFERENCES_EVENT]);
  });

  it("is a button, not a link, so it never navigates away", () => {
    render(<CookieSettingsTrigger className="styled" />);

    const trigger = screen.getByRole("button", { name: "Cookie settings" });
    expect(trigger.getAttribute("type")).toBe("button");
    expect(trigger.className).toContain("styled");
  });
});
