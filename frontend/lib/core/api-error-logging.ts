import type { ApiError, ApiErrorKind } from "./api-error";
import { reportClientError } from "./client-error-report";

export interface ApiErrorReportContext {
  source: "query" | "mutation";
  key?: string | undefined;
  url?: string | undefined;
}

// Only kinds a developer must act on. The rest are expected product flows the
// UI already handles -- except `invalid-response`, which `logValidationError`
// in `lib/core/api.ts` already records at the point of detection with the URL
// and the exact Zod issues.
const REPORTED_ERROR_KINDS: ReadonlySet<ApiErrorKind> = new Set([
  "unexpected",
  "service",
  "network",
  "timeout",
]);

/**
 * Record a normalized API failure for developer observability. Secret-safe by
 * construction: `ApiError.message` is the scrubbed product message and
 * `details` is excluded, while `url` and `key` come from the calling context
 * rather than from the response.
 */
export function reportApiError(
  error: ApiError,
  context: ApiErrorReportContext,
): void {
  if (!REPORTED_ERROR_KINDS.has(error.kind)) {
    return;
  }

  console.error("API error", {
    kind: error.kind,
    status: error.status,
    ...(context.url !== undefined && { url: context.url }),
    code: error.code,
    message: error.message,
    source: context.source,
    ...(context.key !== undefined && { key: context.key }),
  });
  reportClientError({
    kind: "api",
    message: error.message,
    source: context.source,
    ...(error.code !== undefined && { code: error.code }),
  });
}
