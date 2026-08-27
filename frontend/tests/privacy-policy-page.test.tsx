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

import PrivacyPolicyPage from "@/app/privacy-policy/page";

beforeEach(() => {
  auth.isAuthenticated = false;
  auth.isLoading = false;
  cookies.mockImplementation(async () => ({
    get: () => undefined,
  }));
});

describe("the privacy policy page", () => {
  it("states the policy under its own headings, inside the legal shell", async () => {
    render(await PrivacyPolicyPage());

    expect(
      screen.getByRole("heading", { level: 1, name: "Privacy Policy" }),
    ).toBeTruthy();
    for (const section of [
      "Information We Collect",
      "How We Use Your Data",
      "Data Storage and Security",
      "Cookies and Storage",
      "Your Rights",
      "Contact",
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

  it("hands the storage detail off to the cookie policy, by link", async () => {
    // The retention table lives in one place; this page points at it. The
    // footer's legal notice links there too, so every "Cookie Policy" link
    // on the page -- the inline one included -- must agree on the target.
    render(await PrivacyPolicyPage());

    expect(
      screen.getByText(/For the full storage list, retention periods/),
    ).toBeTruthy();
    const links = screen.getAllByRole("link", { name: "Cookie Policy" });
    expect(links.length).toBeGreaterThan(1);
    for (const link of links) {
      expect(link.getAttribute("href")).toBe("/cookie-policy");
    }
  });
});
