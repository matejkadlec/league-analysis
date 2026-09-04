import { normalizeApiError, type StructuredErrorDetail } from "@/lib/core/http/api";

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const EMAIL_CODE_SLOTS = [
  { id: "email-code-1" },
  { id: "email-code-2" },
  { id: "email-code-3" },
  { id: "email-code-4" },
  { id: "email-code-5" },
  { id: "email-code-6" },
] as const;
export const EMAIL_CODE_LENGTH = EMAIL_CODE_SLOTS.length;
export const PASSWORD_REQUIREMENTS_TEXT =
  "Password must be at least 8 characters long and include at least one uppercase letter, lowercase letter, number, and special character.";
export const ACCOUNT_ACTION_BUTTON_CLASS =
  "button-medium no-rotation !h-9 !px-3 !py-2 w-36 justify-center";
export const USER_QUERY_KEY = ["user"] as const;
export const RIOT_API_KEY_QUERY_KEY = ["settings", "riot_api_key"] as const;

export function isPasswordStrong(password: string): boolean {
  if (password.length < 8) {
    return false;
  }

  const hasLowercase = /[a-z]/.test(password);
  const hasUppercase = /[A-Z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecialCharacter = /[!@#$%^&*(),.?":{}|<>\-_+=[\]\\/;'`~]/.test(
    password,
  );

  return hasLowercase && hasUppercase && hasNumber && hasSpecialCharacter;
}

/**
 * The structured detail behind a thrown settings mutation, or undefined when
 * the failure carried none. Every caller here branches on `detail.code`, which
 * `normalizeApiError` has already read and sanitized.
 */
export function settingsErrorDetail(
  error: unknown,
): StructuredErrorDetail | undefined {
  return normalizeApiError(error).details?.detail;
}

export function emptyCodeDigits(): string[] {
  return EMAIL_CODE_SLOTS.map(() => "");
}

/** Inline message under the new-email field, keyed by the backend's code. */
export const EMAIL_REQUEST_ERRORS: Record<string, string> = {
  EMAIL_UNCHANGED:
    "New email must be different from your current email address.",
  EMAIL_ALREADY_REGISTERED: "This email address is already registered.",
};

/** Inline message under the verification code, keyed by the backend's code. */
export const EMAIL_VERIFY_ERRORS: Record<string, string> = {
  EMAIL_CHANGE_INVALID_CODE: "This code is incorrect.",
  EMAIL_CHANGE_CODE_EXPIRED:
    "This code has expired. Use 'Resend the code.' to get a new one.",
  EMAIL_CHANGE_REQUEST_NOT_FOUND: "No active code found. Please resend the code.",
};

/** Both email-change steps lock out on either of the same two codes. */
export function isEmailLockCode(code: string | undefined): boolean {
  return (
    code === "EMAIL_CHANGE_LOCKED" || code === "EMAIL_CHANGE_TOO_MANY_ATTEMPTS"
  );
}
