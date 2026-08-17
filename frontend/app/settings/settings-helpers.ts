import type { ApiError } from "@/lib/core/api";

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

export interface MutationError extends Error {
  code?: string | undefined;
  lockedUntil?: string | undefined;
  attemptsRemaining?: number | undefined;
  status?: number | undefined;
}

export function isPasswordStrong(password: string): boolean {
  if (password.length < 8) {
    return false;
  }

  const hasLowercase = /[a-z]/.test(password);
  const hasUppercase = /[A-Z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecialCharacter = /[!@#$%^&*(),.?":{}|<>\-_+=\[\]\\/;'`~]/.test(
    password,
  );

  return hasLowercase && hasUppercase && hasNumber && hasSpecialCharacter;
}

export function toMutationError(apiError: ApiError): MutationError {
  // `normalizeApiError` has already read and sanitized the structured detail;
  // re-parsing it here would only re-derive what `ApiError.details` states.
  const detail = apiError.details?.detail;
  const error = new Error(detail?.message ?? apiError.message) as MutationError;
  error.code = detail?.code;
  error.lockedUntil = detail?.locked_until;
  error.attemptsRemaining = detail?.attempts_remaining;
  error.status = apiError.status;
  return error;
}

export function emptyCodeDigits(): string[] {
  return EMAIL_CODE_SLOTS.map(() => "");
}
