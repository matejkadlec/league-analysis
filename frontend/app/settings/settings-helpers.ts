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

interface BackendErrorDetail {
  code?: string | undefined;
  message?: string | undefined;
  locked_until?: string | undefined;
  attempts_remaining?: number | undefined;
}

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

function parseBackendErrorDetail(
  apiError: ApiError,
): BackendErrorDetail | null {
  if (!apiError.details || typeof apiError.details !== "object") {
    return null;
  }

  const detailContainer = apiError.details as { detail?: unknown };
  if (!detailContainer.detail || typeof detailContainer.detail !== "object") {
    return null;
  }

  const detail = detailContainer.detail as Record<string, unknown>;
  return {
    code: typeof detail.code === "string" ? detail.code : undefined,
    message: typeof detail.message === "string" ? detail.message : undefined,
    locked_until:
      typeof detail.locked_until === "string" ? detail.locked_until : undefined,
    attempts_remaining:
      typeof detail.attempts_remaining === "number"
        ? detail.attempts_remaining
        : undefined,
  };
}

export function toMutationError(apiError: ApiError): MutationError {
  const detail = parseBackendErrorDetail(apiError);
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
