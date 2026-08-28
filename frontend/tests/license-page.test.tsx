// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A server component page: the test awaits the element it returns and renders
 * that. `next/headers` is the only server boundary, mocked as a cookie jar.
 */

type CookieStore = {
  get: (name: string) => { name: string; value: string } | undefined;
};

const { cookies } = vi.hoisted(() => ({
  cookies: vi.fn<() => Promise<CookieStore>>(),
}));

vi.mock("next/headers", () => ({ cookies }));

const auth = vi.hoisted(() => ({ isAuthenticated: false, isLoading: false }));

vi.mock("@/features/auth", () => ({
  useAuth: () => auth,
}));

import LicensePage from "@/app/license/page";

beforeEach(() => {
  auth.isAuthenticated = false;
  auth.isLoading = false;
  cookies.mockImplementation(async () => ({
    get: () => undefined,
  }));
});

describe("the license page", () => {
  it("states the terms under their own headings, inside the legal shell", async () => {
    render(await LicensePage());

    expect(
      screen.getByRole("heading", { level: 1, name: "License" }),
    ).toBeTruthy();
    for (const section of [
      "Terms of Use",
      "Data Source",
      "Disclaimer",
      "Copyright",
    ]) {
      expect(
        screen.getByRole("heading", { level: 2, name: section }),
      ).toBeTruthy();
    }
    expect(
      screen
        .getByRole("link", { name: "Back to Sign In page" })
        .getAttribute("href"),
    ).toBe("/sign-in");
  });

  it("names the Riot API as the data source and disclaims accuracy", async () => {
    // The two statements that carry legal weight for a Riot-key holder: the
    // data is Riot's, and the analysis is not a promise.
    render(await LicensePage());

    expect(
      screen.getByText(/League Analysis uses data from the Riot Games API/),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /We do not guarantee the accuracy or completeness of any information/,
      ),
    ).toBeTruthy();
  });
});
