// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A server component page: the test awaits the element it returns and renders
 * that. `next/headers` is the only server boundary, mocked as a plain cookie
 * jar the tests fill by hand.
 */

type CookieStore = {
  get: (name: string) => { name: string; value: string } | undefined;
};

const { cookies } = vi.hoisted(() => ({
  cookies: vi.fn<() => Promise<CookieStore>>(),
}));

vi.mock("next/headers", () => ({ cookies }));

// The shell's signed-out chrome reads the client session; the fields the
// shell consults are the only ones the mock needs to answer with.
const auth = vi.hoisted(() => ({ isAuthenticated: false, isLoading: false }));

vi.mock("@/features/auth", () => ({
  useAuth: () => auth,
}));

import CookiePolicyPage from "@/app/cookie-policy/page";
import {
  AUTH_STATE_COOKIE_NAME,
  AUTH_STATE_COOKIE_VALUE,
} from "@/lib/session/auth-state-cookie";
import { COOKIE_CONSENT_VERSION } from "@/features/cookie-consent/consent-storage";

const jar = new Map<string, string>();

beforeEach(() => {
  jar.clear();
  auth.isAuthenticated = false;
  auth.isLoading = false;
  cookies.mockImplementation(async () => ({
    get: (name: string) =>
      jar.has(name) ? { name, value: jar.get(name)! } : undefined,
  }));
});

async function renderPage() {
  render(await CookiePolicyPage());
}

describe("the cookie policy page", () => {
  it("states the policy under its own heading, inside the legal shell", async () => {
    await renderPage();

    expect(
      screen.getByRole("heading", { level: 1, name: "Cookie Policy" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { level: 2, name: "How Consent Works" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { level: 2, name: "Storage We Use" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { level: 2, name: "Third-Party Storage" }),
    ).toBeTruthy();
    // The shell is what puts the public chrome on this page; the way back is
    // its most assertable piece.
    expect(
      screen
        .getByRole("link", { name: "Back to Sign In page" })
        .getAttribute("href"),
    ).toBe("/sign-in");
  });

  it("lists every storage key the application actually opens", async () => {
    await renderPage();

    // A page about storage that misses a key the app uses is a silent
    // disclosure gap, so the names are pinned as rendered text. They render
    // with a zero-width break after each underscore so long keys can wrap.
    expect(
      screen.getByText("league_\u200banalysis_\u200bauth_\u200bstate"),
    ).toBeTruthy();
    expect(
      screen.getByText("league_\u200banalysis_\u200baccess_\u200btoken"),
    ).toBeTruthy();
    expect(
      screen.getByText("league_\u200banalysis_\u200brefresh_\u200btoken"),
    ).toBeTruthy();
    expect(
      screen.getByText("league_\u200banalysis_\u200bcookie_\u200bconsent"),
    ).toBeTruthy();
    // The unbroken name must not also be on the page: that would mean the
    // wrapping transformation was dropped somewhere.
    expect(screen.queryByText("league_analysis_auth_state")).toBeNull();

    expect(screen.getByText(COOKIE_CONSENT_VERSION)).toBeTruthy();
  });

  it("drops the public chrome when the signed-in hint is present", async () => {
    // While the client session probe is still in flight, the hint cookie is
    // all the shell has: the page has to pass it on or a signed-in visitor
    // gets the "back to sign in" button over the app they are already in.
    auth.isLoading = true;
    jar.set(AUTH_STATE_COOKIE_NAME, AUTH_STATE_COOKIE_VALUE);

    await renderPage();

    expect(
      screen.getByRole("heading", { level: 1, name: "Cookie Policy" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("link", { name: "Back to Sign In page" }),
    ).toBeNull();
  });
});
