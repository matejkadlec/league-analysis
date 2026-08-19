import { describe, expect, it } from "vitest";

import {
  createAuthLoginError,
  getLoginErrorMessage,
  getLoginRequestError,
  isAuthLoginError,
} from "../features/auth/utils/login-error";

describe("sign-in error mapping", () => {
  it("maps trusted authentication responses without rendering backend details", () => {
    expect(
      getLoginErrorMessage(
        createAuthLoginError(
          { detail: "Incorrect email or password" },
          401,
        ),
      ),
    ).toBe("The email or password is incorrect.");
    expect(
      getLoginErrorMessage(
        createAuthLoginError({ detail: "internal validation details" }, 422),
      ),
    ).toBe("Please enter a valid email address and password.");
    expect(
      getLoginErrorMessage(
        createAuthLoginError({ detail: "upstream failed" }, 503),
      ),
    ).toBe("Sign-in is temporarily unavailable. Please try again.");
  });

  it("distinguishes network, timeout, and unexpected browser failures", () => {
    expect(
      getLoginErrorMessage(createAuthLoginError(null, undefined, "NETWORK_ERROR")),
    ).toBe(
      "Sign-in is temporarily unavailable. Please check your connection and try again.",
    );
    expect(
      getLoginErrorMessage(createAuthLoginError(null, undefined, "REQUEST_TIMEOUT")),
    ).toBe("Sign-in is taking too long. Please try again.");
    expect(getLoginErrorMessage(new Error("Failed to fetch"))).toBe(
      "Something went wrong while signing in. Please try again.",
    );
  });

  it("does not mistake browser abort errors for authentication errors", () => {
    const abortError = Object.assign(new Error("The operation was aborted"), {
      code: 20,
      name: "AbortError",
    });

    expect(isAuthLoginError(abortError)).toBe(false);
    expect(getLoginRequestError(abortError, true).code).toBe("REQUEST_TIMEOUT");
    expect(getLoginRequestError(abortError, false).code).toBe(
      "REQUEST_TIMEOUT",
    );
    expect(
      getLoginErrorMessage(getLoginRequestError(abortError, true)),
    ).toBe("Sign-in is taking too long. Please try again.");
    expect(
      isAuthLoginError(
        createAuthLoginError(null, undefined, "REQUEST_TIMEOUT"),
      ),
    ).toBe(true);
  });

  it("preserves application errors and maps other request failures to network errors", () => {
    const authenticationError = createAuthLoginError(
      { detail: "Incorrect email or password" },
      401,
    );

    expect(getLoginRequestError(authenticationError, false)).toBe(
      authenticationError,
    );
    expect(getLoginRequestError(new Error("Failed to fetch"), false).code).toBe(
      "NETWORK_ERROR",
    );
  });

  it("keeps account and CAPTCHA responses user-safe", () => {
    expect(
      getLoginErrorMessage(
        createAuthLoginError({ detail: { code: "ACCOUNT_INACTIVE" } }, 403),
      ),
    ).toBe("This account is inactive. Please contact an administrator.");
    expect(
      getLoginErrorMessage(
        createAuthLoginError(
          {
            detail: {
              code: "ACCOUNT_LOCKED",
              locked_until: "not-a-date",
              message: "backend-only detail",
            },
          },
          423,
        ),
      ),
    ).toBe("Too many sign-in attempts. Please try again later.");
    expect(
      getLoginErrorMessage(
        createAuthLoginError({ detail: { code: "CAPTCHA_REQUIRED" } }, 403),
      ),
    ).toBe("Complete the security check to continue signing in.");
    expect(getLoginErrorMessage(createAuthLoginError(null, 403))).toBe(
      "Something went wrong while signing in. Please try again.",
    );
  });

  it("tells a locked-out account when it may try again", () => {
    // The existing lockout case only passes an unparseable `locked_until`,
    // so the branch that actually names a time had never run. Without it a
    // lockout says "please try again later" and the person is left guessing
    // between a minute and the rest of the day -- which is the whole reason
    // the server sends the timestamp.
    //
    // The time itself is `toLocaleString()`, so the exact string depends on
    // the locale and zone the process runs under. Asserting the shape keeps
    // this saying the same thing on a Prague laptop and in the gate
    // container, where `LANG=C` and UTC would produce something else.
    const message = getLoginErrorMessage(
      createAuthLoginError(
        {
          detail: {
            code: "ACCOUNT_LOCKED",
            locked_until: "2026-03-04T14:07:00Z",
          },
        },
        423,
      ),
    );

    expect(message).toMatch(
      /^Too many sign-in attempts\. Try again after .+\.$/,
    );
    expect(message).not.toBe(
      "Too many sign-in attempts. Please try again later.",
    );
  });

  it("names the two refusals a person can act on themselves", () => {
    // A rejected CAPTCHA and a rate limit are both recoverable by the person
    // in front of the form -- solve it again, or wait. Falling through to
    // "Something went wrong" turns both into a dead end, and the CAPTCHA one
    // is reachable on any retry after a failed check.
    expect(
      getLoginErrorMessage(
        createAuthLoginError({ detail: { code: "CAPTCHA_INVALID" } }, 403),
      ),
    ).toBe("The security check could not be verified. Please try again.");
    expect(getLoginErrorMessage(createAuthLoginError(null, 429))).toBe(
      "Too many sign-in attempts. Please wait a moment and try again.",
    );
  });
});
