import type { Page } from "@playwright/test";

export async function seedAuthenticatedSession(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      name: "league_analysis_auth_state",
      value: "1",
      url: "http://127.0.0.1:3100",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}
