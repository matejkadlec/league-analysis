import type { Page } from "@playwright/test";

export async function seedAuthenticatedSession(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      name: "league_analysis_auth_state",
      value: "1",
      url: "http://127.0.0.1:3100",
      // Readable, matching what `set_auth_cookies` writes. `AuthProvider`
      // checks this from `document.cookie`, so seeding it HttpOnly would hide
      // the session from the very client code the specs are exercising.
      httpOnly: false,
      sameSite: "Lax",
    },
  ]);
}

/**
 * The consent dialog is modal, so until it is dismissed Radix marks the rest
 * of the page `aria-hidden` and every role query on it finds nothing.
 */
export async function acceptCookieBanner(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Accept necessary" }).click();
}
