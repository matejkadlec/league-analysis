import axios from "axios";
import { z } from "zod";

export type ApiErrorKind =
  | "validation"
  | "authentication"
  | "authorization"
  | "not-found"
  | "conflict"
  | "rate-limit"
  | "network"
  | "timeout"
  | "service"
  | "invalid-response"
  | "unexpected";

export interface ApiError {
  message: string;
  code?: string | undefined;
  status?: number | undefined;
  kind: ApiErrorKind;
  details?: unknown;
}

interface StructuredErrorDetail {
  code?: string | undefined;
  message?: string | undefined;
  locked_until?: string | undefined;
  attempts_remaining?: number | undefined;
  retry_after_seconds?: number | undefined;
}

interface ExtractedResponseError {
  code?: string | undefined;
  message?: string | undefined;
  structuredDetail?: StructuredErrorDetail | undefined;
}

const SAFE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;
const TECHNICAL_MESSAGE_PATTERN =
  /(?:internal server|failed to fetch|network error|err_[a-z_]+|traceback|stack trace|sql(?:alchemy)?|postgres|axios|https?:\/\/|\/api\/|riotapierror|\bat\s+[A-Za-z_$][\w$]*\s*\(|rgapi-[A-Za-z0-9-]+)/i;

function readStructuredDetail(value: unknown): StructuredErrorDetail | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const detail = value as Record<string, unknown>;
  return {
    code:
      typeof detail.code === "string" && SAFE_CODE_PATTERN.test(detail.code)
        ? detail.code
        : undefined,
    message:
      typeof detail.message === "string" ? detail.message.trim() : undefined,
    locked_until:
      typeof detail.locked_until === "string"
        ? detail.locked_until
        : undefined,
    attempts_remaining:
      typeof detail.attempts_remaining === "number"
        ? detail.attempts_remaining
        : undefined,
    retry_after_seconds:
      typeof detail.retry_after_seconds === "number"
        ? detail.retry_after_seconds
        : undefined,
  };
}

function extractResponseError(data: unknown): ExtractedResponseError {
  if (typeof data !== "object" || data === null) {
    return {};
  }

  const response = data as Record<string, unknown>;
  const structuredDetail = readStructuredDetail(response.detail);
  const responseCode =
    typeof response.error_code === "string" &&
    SAFE_CODE_PATTERN.test(response.error_code)
      ? response.error_code
      : undefined;
  const stringDetail =
    typeof response.detail === "string" ? response.detail.trim() : undefined;
  const detailCode =
    stringDetail && SAFE_CODE_PATTERN.test(stringDetail)
      ? stringDetail
      : undefined;
  const responseMessage =
    typeof response.message === "string" ? response.message.trim() : undefined;

  return {
    code: structuredDetail?.code ?? responseCode ?? detailCode,
    message: structuredDetail?.message ?? stringDetail ?? responseMessage,
    structuredDetail: structuredDetail ?? undefined,
  };
}

function isSafeProductMessage(message: string | undefined): message is string {
  if (!message || message.length > 240) {
    return false;
  }

  return !TECHNICAL_MESSAGE_PATTERN.test(message);
}

function sanitizedDetails(
  structuredDetail: StructuredErrorDetail | undefined,
): { detail: StructuredErrorDetail } | undefined {
  if (!structuredDetail) {
    return undefined;
  }

  const detail: StructuredErrorDetail = {
    code: structuredDetail.code,
    message: isSafeProductMessage(structuredDetail.message)
      ? structuredDetail.message
      : undefined,
    locked_until: structuredDetail.locked_until,
    attempts_remaining: structuredDetail.attempts_remaining,
    retry_after_seconds: structuredDetail.retry_after_seconds,
  };

  return { detail };
}

function responseApiError(
  status: number | undefined,
  extracted: ExtractedResponseError,
): ApiError {
  const trustedStructuredMessage =
    Boolean(extracted.structuredDetail?.code) &&
    isSafeProductMessage(extracted.structuredDetail?.message)
      ? extracted.structuredDetail?.message
      : undefined;
  const safeMessage = isSafeProductMessage(extracted.message)
    ? extracted.message
    : undefined;
  const details = sanitizedDetails(extracted.structuredDetail);

  if (extracted.code === "RIOT_API_KEY_INVALID") {
    return {
      kind: "service",
      code: extracted.code,
      status,
      message:
        "Riot data is temporarily unavailable. Please contact an administrator.",
      details,
    };
  }

  if (status === 400 || status === 422) {
    return {
      kind: "validation",
      code: extracted.code ?? "VALIDATION_ERROR",
      status,
      message:
        trustedStructuredMessage ??
        safeMessage ??
        "The request could not be completed. Check the information and try again.",
      details,
    };
  }

  if (status === 401) {
    return {
      kind: "authentication",
      code: extracted.code ?? "AUTHENTICATION_REQUIRED",
      status,
      message: "Your session expired. Please sign in again.",
      details,
    };
  }

  if (status === 403) {
    return {
      kind: "authorization",
      code: extracted.code ?? "ACTION_FORBIDDEN",
      status,
      message:
        trustedStructuredMessage ??
        "You do not have permission to complete this action.",
      details,
    };
  }

  if (status === 404) {
    return {
      kind: "not-found",
      code: extracted.code ?? "NOT_FOUND",
      status,
      message: safeMessage ?? "The requested item could not be found.",
      details,
    };
  }

  if (status === 409) {
    return {
      kind: "conflict",
      code: extracted.code ?? "CONFLICT",
      status,
      message:
        trustedStructuredMessage ??
        safeMessage ??
        "The request conflicts with the current state. Refresh and try again.",
      details,
    };
  }

  if (status === 429) {
    return {
      kind: "rate-limit",
      code: extracted.code ?? "RATE_LIMITED",
      status,
      message:
        trustedStructuredMessage ??
        "Too many requests. Please wait a moment and try again.",
      details,
    };
  }

  if (status !== undefined && status >= 500) {
    return {
      kind: "service",
      code: extracted.code ?? "SERVICE_ERROR",
      status,
      message:
        trustedStructuredMessage ??
        "The League Analysis service could not complete the request. Please try again later.",
      details,
    };
  }

  return {
    kind: "unexpected",
    code: extracted.code ?? "UNKNOWN_ERROR",
    status,
    message: "The request could not be completed. Please try again later.",
    details,
  };
}

export function normalizeApiError(error: unknown): ApiError {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    if (status !== undefined) {
      return responseApiError(status, extractResponseError(error.response?.data));
    }

    if (
      error.code === "ECONNABORTED" ||
      error.code === "ETIMEDOUT" ||
      error.message.toLowerCase().includes("timeout")
    ) {
      return {
        kind: "timeout",
        code: "REQUEST_TIMEOUT",
        message: "The request took too long. Please try again.",
      };
    }

    // A reachability failure may point at this application's own backend, and
    // never at the user's internet connection. The browser reached this code,
    // so their connection demonstrably works; blaming it sends people to
    // reboot a router over a service outage.
    return {
      kind: "network",
      code: "NETWORK_ERROR",
      message:
        "Unable to reach the League Analysis service. Please try again. If the problem continues, check that the backend is running.",
    };
  }

  if (error instanceof z.ZodError) {
    return {
      kind: "invalid-response",
      code: "INVALID_RESPONSE",
      message:
        "The League Analysis service returned an unexpected response. Please try again later.",
    };
  }

  return {
    kind: "unexpected",
    code: "UNKNOWN_ERROR",
    message: "The request could not be completed. Please try again later.",
  };
}

export function apiErrorMessage(
  error: ApiError,
  contextualFallback: string,
): string {
  if (
    error.kind === "validation" ||
    error.kind === "authentication" ||
    error.kind === "authorization" ||
    error.kind === "not-found" ||
    error.kind === "conflict" ||
    error.kind === "rate-limit"
  ) {
    return error.message;
  }

  return contextualFallback;
}
