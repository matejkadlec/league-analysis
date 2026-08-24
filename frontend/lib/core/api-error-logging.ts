import type { ApiError, ApiErrorKind } from "./api-error";
import { reportClientError } from "./client-error-report";

export interface ApiErrorReportContext {
  source: "query" | "mutation";
  key?: string | undefined;
  url?: string | undefined;
}

// Only kinds a developer must act on: the service or the transport failed in
// a way no user input caused. The remaining kinds stay silent because they
// are expected product flows, not defects:
// - validation/authentication/authorization/not-found/conflict/rate-limit
//   describe ordinary client behaviour the UI already handles, and
// - invalid-response is already recorded by `logValidationError` in
//   `lib/core/api.ts` at the point of detection, with the URL and the exact
//   Zod issues a second record here would only duplicate.
const REPORTED_ERROR_KINDS: ReadonlySet<ApiErrorKind> = new Set([
  "unexpected",
  "service",
  "network",
  "timeout",
]);

/**
 * Record a normalized API failure for developer observability.
 *
 * The payload stays secret-safe by construction: `ApiError.message` is the
 * product message `normalizeApiError` already scrubbed of raw response
 * bodies, and `details` is deliberately excluded from the record. The
 * optional `url` and `key` come from the calling context, never from the
 * response.
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
