// @vitest-environment jsdom

import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithQueryClient } from "./render-support";

/**
 * Whose decision the cookie banner is recording.
 *
 * The consent cookie is jar-wide and the banner has to work before anyone
 * signs in, so a visitor's choice is necessarily browser-level. The bug was
 * what happened next: a second account signing in on the same browser
 * inherited that choice without ever being asked, and the manager wrote the
 * inherited choice to `/settings/user/cookie-consent` as
 * `consent_source: "banner"` -- a record saying somebody clicked a banner
 * they never saw.
 *
 * These assert against the account's own stored record, which is the only
 * thing that holds a statement by a person.
 */

const { validatedGet, validatedPut, useAuth } = vi.hoisted(() => ({
  validatedGet: vi.fn(),
  validatedPut: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock("@/lib/core/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/api")>()),
  validatedGet,
  validatedPut,
}));

vi.mock("@/features/auth", () => ({ useAuth }));

import { CookieConsentManager } from "../features/cookie-consent/components/cookie-consent-manager";
import {
  COOKIE_CONSENT_COOKIE_NAME,
  COOKIE_CONSENT_VERSION,
  readCookieConsentFromBrowser,
} from "../features/cookie-consent/utils/consent-storage";

/** The banner is the only element that is blocking, so its title identifies it. */
const BANNER_TITLE = "Cookie and Local Storage Preferences";

function signedInAs(id: number) {
  useAuth.mockReturnValue({ isAuthenticated: true, user: { id } });
}

/** A choice already in the jar, as though the previous account had accepted. */
function putConsentCookieInTheJar(level: "all" | "necessary") {
  document.cookie =
    `${COOKIE_CONSENT_COOKIE_NAME}=` +
    encodeURIComponent(
      `${COOKIE_CONSENT_VERSION}|${level}|2026-08-01T00:00:00.000Z`,
    ) +
    "; Path=/";
}

function serverAnswers(
  stored: {
    consent_level: "all" | "necessary";
    consent_version: string;
  } | null,
) {
  validatedGet.mockResolvedValue({
    success: true,
    data:
      stored === null
        ? null
        : {
            ...stored,
            consent_source: "banner",
            consented_at: "2026-07-01T00:00:00.000Z",
            updated_at: "2026-07-01T00:00:00.000Z",
          },
  });
}

async function mount() {
  const view = renderWithQueryClient(<CookieConsentManager />);
  // The mount effect reads the cookie; the reconcile below it awaits a fetch.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return view;
}

describe("the consent banner when the signed-in account changes", () => {
  beforeEach(() => {
    validatedGet.mockReset();
    validatedPut.mockReset();
    useAuth.mockReset();
    validatedPut.mockResolvedValue({
      success: true,
      data: {
        consent_level: "all",
        consent_version: COOKIE_CONSENT_VERSION,
        consent_source: "banner",
        consented_at: "2026-08-22T00:00:00.000Z",
        updated_at: "2026-08-22T00:00:00.000Z",
      },
    });
    document.cookie = `${COOKIE_CONSENT_COOKIE_NAME}=; Path=/; Max-Age=0`;
  });

  afterEach(cleanup);

  it("asks an account that has never answered, rather than inheriting the jar", async () => {
    // The defect, stated as a test: account B arrives on a browser where A
    // accepted everything.
    putConsentCookieInTheJar("all");
    signedInAs(2);
    serverAnswers(null);

    await mount();

    expect(screen.getByText(BANNER_TITLE)).toBeTruthy();
  });

  it("writes nothing to the audit trail of an account that has not answered", async () => {
    // The half that matters legally. Inheriting quietly would be bad; writing
    // `consent_source: "banner"` for a banner this account never saw is a
    // false record of consent.
    putConsentCookieInTheJar("all");
    signedInAs(2);
    serverAnswers(null);

    await mount();

    expect(validatedPut).not.toHaveBeenCalled();
  });

  it("lets an account's own stored record overrule the jar", async () => {
    // Not merely "does not inherit": B chose `necessary` on another device,
    // and that must survive arriving on a browser whose cookie says `all`.
    putConsentCookieInTheJar("all");
    signedInAs(2);
    serverAnswers({
      consent_level: "necessary",
      consent_version: COOKIE_CONSENT_VERSION,
    });

    await mount();

    expect(screen.queryByText(BANNER_TITLE)).toBeNull();
    expect(readCookieConsentFromBrowser()?.level).toBe("necessary");
  });

  it("leaves an account that has answered alone", async () => {
    // The positive control, and the one that makes the first two mean
    // something: prompting on every sign-in would pass those tests too, and
    // would re-ask everybody who has already decided.
    putConsentCookieInTheJar("all");
    signedInAs(1);
    serverAnswers({
      consent_level: "all",
      consent_version: COOKIE_CONSENT_VERSION,
    });

    await mount();

    expect(screen.queryByText(BANNER_TITLE)).toBeNull();
    expect(readCookieConsentFromBrowser()?.level).toBe("all");
  });

  it("records the choice of a visitor who answers and then signs in", async () => {
    // The one branch that writes to an audit trail, and the reason the ref
    // exists at all: nobody is signed in, the person answers the banner, and
    // then signs in. That choice is theirs, made seconds ago, so re-asking
    // them as soon as they authenticate would be the wrong kind of careful.
    useAuth.mockReturnValue({ isAuthenticated: false, user: null });
    serverAnswers(null);
    const { rerender } = await mount();

    await act(async () => {
      screen.getByRole("button", { name: "Accept all" }).click();
      await Promise.resolve();
    });

    signedInAs(5);
    await act(async () => {
      rerender(<CookieConsentManager />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(validatedPut).toHaveBeenCalledWith(
      expect.anything(),
      "/settings/user/cookie-consent",
      expect.objectContaining({ consent_level: "all" }),
    );
  });

  it("does not carry one account's choice through a sign-out into the next", async () => {
    // `logout` is a `router.push` and this component lives in the root
    // layout, so it is never remounted across a sign-out. A ref that recorded
    // only *that* a choice was made -- rather than who made it -- would still
    // be set when the next account signed in, and would write the previous
    // account's level into theirs.
    signedInAs(4);
    serverAnswers(null);
    const { rerender } = await mount();

    await act(async () => {
      screen.getByRole("button", { name: "Accept all" }).click();
      await Promise.resolve();
    });
    validatedPut.mockClear();

    // Signed out, then in as somebody else -- no remount in between.
    useAuth.mockReturnValue({ isAuthenticated: false, user: null });
    await act(async () => {
      rerender(<CookieConsentManager />);
      await Promise.resolve();
    });
    signedInAs(6);
    await act(async () => {
      rerender(<CookieConsentManager />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(validatedPut).not.toHaveBeenCalled();
    expect(screen.getByText(BANNER_TITLE)).toBeTruthy();
  });

  it("keeps the browser's answer when the record cannot be read", async () => {
    // A failed request is not evidence that nobody consented. Treating it as
    // one would re-ask a signed-in viewer every time the backend hiccups.
    putConsentCookieInTheJar("all");
    signedInAs(1);
    validatedGet.mockResolvedValue({
      success: false,
      error: { status: 503, message: "unavailable" },
    });

    await mount();

    expect(screen.queryByText(BANNER_TITLE)).toBeNull();
    expect(validatedPut).not.toHaveBeenCalled();
  });
});
