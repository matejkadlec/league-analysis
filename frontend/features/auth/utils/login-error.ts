import { formatDateTime } from "@/lib/core/format";

import type { AuthLoginError } from "../types";

/**
 * Said by the sign-in form and by every gated surface a deactivated session
 * still reaches, so it is written once. The two used to disagree on whether
 * the administrator could restore the account; this is the wording that says
 * what the visitor can actually do about it.
 */
export const ACCOUNT_INACTIVE_MESSAGE =
  "This account is inactive. Contact an administrator to restore access.";

export const LOGIN_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Deadline for the session probe and the refresh that follows it.
 *
 * Shorter than the login deadline on purpose: a sign-in is a deliberate act
 * whose result is worth waiting for, while this runs before the page can draw
 * anything. A stalled connection here holds every gated surface at `null`, so
 * failing quickly and saying so beats waiting quietly.
 */
export const AUTH_PROBE_TIMEOUT_MS = 10_000;

type LoginErrorDetail = {
  code?: unknown;
  locked_until?: unknown;
};

function getLoginErrorDetail(payload: unknown): LoginErrorDetail | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const detail = (payload as { detail?: unknown }).detail;
  return detail && typeof detail === "object"
    ? (detail as LoginErrorDetail)
    : null;
}

export function createAuthLoginError(
  payload: unknown,
  status?: number,
  code?: AuthLoginError["code"],
): AuthLoginError {
  const error = new Error("Sign-in failed") as AuthLoginError;
  error.status = status;
  error.code = code;

  const detail = getLoginErrorDetail(payload);
  if (!detail) {
    return error;
  }

  if (typeof detail.code === "string") {
    error.code = detail.code;
  }

  if (typeof detail.locked_until === "string") {
    error.lockedUntil = detail.locked_until;
  }

  return error;
}

export function isAuthLoginError(error: unknown): error is AuthLoginError {
  if (!(error instanceof Error)) {
    return false;
  }

  const authError = error as Partial<AuthLoginError>;
  return (
    typeof authError.code === "string" ||
    typeof authError.status === "number" ||
    typeof authError.lockedUntil === "string"
  );
}

export function getLoginRequestError(
  error: unknown,
  didTimeout: boolean,
): AuthLoginError {
  if (didTimeout || (error instanceof Error && error.name === "AbortError")) {
    return createAuthLoginError(null, undefined, "REQUEST_TIMEOUT");
  }

  if (isAuthLoginError(error)) {
    return error;
  }

  return createAuthLoginError(null, undefined, "NETWORK_ERROR");
}

function formatLockoutTime(lockedUntil: string): string | null {
  const lockoutTime = new Date(lockedUntil);
  return Number.isNaN(lockoutTime.getTime())
    ? null
    : formatDateTime(lockedUntil);
}

export function getLoginErrorMessage(error: unknown): string {
  if (!isAuthLoginError(error)) {
    return "Something went wrong while signing in. Please try again.";
  }

  switch (error.code) {
    case "ACCOUNT_INACTIVE":
      return ACCOUNT_INACTIVE_MESSAGE;
    case "ACCOUNT_LOCKED": {
      const lockoutTime = error.lockedUntil
        ? formatLockoutTime(error.lockedUntil)
        : null;
      return lockoutTime
        ? `Too many sign-in attempts. Try again after ${lockoutTime}.`
        : "Too many sign-in attempts. Please try again later.";
    }
    case "CAPTCHA_REQUIRED":
      return "Complete the security check to continue signing in.";
    case "CAPTCHA_INVALID":
      return "The security check could not be verified. Please try again.";
    case "NETWORK_ERROR":
      return "Sign-in is temporarily unavailable. Please check your connection and try again.";
    case "REQUEST_TIMEOUT":
      return "Sign-in is taking too long. Please try again.";
    default:
      break;
  }

  if (error.status === 401) {
    return "The email or password is incorrect.";
  }

  if (error.status === 422) {
    return "Please enter a valid email address and password.";
  }

  if (error.status === 429) {
    return "Too many sign-in attempts. Please wait a moment and try again.";
  }

  if (error.status !== undefined && error.status >= 500) {
    return "Sign-in is temporarily unavailable. Please try again.";
  }

  return "Something went wrong while signing in. Please try again.";
}
