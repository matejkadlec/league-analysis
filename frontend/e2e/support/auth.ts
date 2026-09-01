import type { Page } from "@playwright/test";

export async function seedAuthenticatedSession(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      name: "league_analysis_auth_state",
      value: "1",
      url: "http://127.0.0.1:3100",
      // `AuthProvider` reads this from `document.cookie`, so seeding it
      // HttpOnly would hide the session from the code under test.
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
