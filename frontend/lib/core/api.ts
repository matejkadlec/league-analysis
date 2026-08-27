import axios, {
  AxiosError,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";
import { z } from "zod";
import { ApiRequestError, normalizeApiError } from "./api-error";
export {
  apiErrorMessage,
  normalizeApiError,
  type ApiError,
  type StructuredErrorDetail,
} from "./api-error";
import type { ApiError } from "./api-error";
import { notifyRiotCredentialHealthUpdated } from "./riot-credential-health-events";
import { refreshAccessToken } from "@/features/auth/utils/token-manager";

const API_BASE_URL =
  typeof window === "undefined"
    ? process.env.API_INTERNAL_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      "http://localhost:8000"
    : "";

export const api = axios.create({
  baseURL: `${API_BASE_URL}/api/v1`,
  headers: { "Content-Type": "application/json" },
  timeout: 30000,
  withCredentials: true,
});

export type ApiResponse<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: ApiError;
      /** The original exception, non-enumerable so a serialized result shows
       * only the sanitized `error`. */
      readonly cause?: unknown;
    };

/**
 * Unwrap an `ApiResponse` inside a query or mutation function. The `validated*`
 * helpers resolve rather than reject, so a caller reading only `.data` renders
 * a failure as a silent empty state and never reaches the `QueryCache` toast.
 */
export function unwrap<T>(result: ApiResponse<T>): T {
  if (!result.success) {
    throw new ApiRequestError(result.error, { cause: result.cause });
  }
  return result.data;
}

/**
 * `unwrap`, except a 404 is an ordinary empty state: several resources exist
 * only once something has happened, so their absence is what the surface
 * renders. Every other status still throws and reaches the `QueryCache` toast.
 */
export function unwrapOr404<T, F>(result: ApiResponse<T>, fallback: F): T | F {
  if (!result.success && result.error.status === 404) {
    return fallback;
  }
  return unwrap(result);
}

// Standard error code returned by backend when Riot API key is invalid
const RIOT_API_KEY_INVALID_CODE = "RIOT_API_KEY_INVALID";

function isApiKeyError(response: AxiosResponse | undefined): boolean {
  if (!response) return false;
  const detail = response.data?.detail;
  return (
    detail === RIOT_API_KEY_INVALID_CODE ||
    (typeof detail === "object" &&
      detail !== null &&
      detail.code === RIOT_API_KEY_INVALID_CODE)
  );
}

api.interceptors.response.use(
  (response: AxiosResponse) => {
    if (
      (response.data as { error_code?: unknown } | null)?.error_code ===
      RIOT_API_KEY_INVALID_CODE
    ) {
      notifyRiotCredentialHealthUpdated();
    }
    return response;
  },
  async (error: AxiosError) => {
    // Check ALL responses for API key errors (503 with specific code)
    // This ensures any endpoint that internally uses Riot API will trigger the header
    if (isApiKeyError(error.response)) {
      notifyRiotCredentialHealthUpdated();
    }

    const originalRequest = error.config as
      (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
    const status = error.response?.status;

    if (!originalRequest || status !== 401 || originalRequest._retry) {
      return Promise.reject(error);
    }

    const requestUrl = originalRequest.url ?? "";
    if (
      requestUrl.includes("/auth/login") ||
      requestUrl.includes("/auth/refresh")
    ) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;
    const refresh = await refreshAccessToken();
    if (refresh.outcome !== "refreshed") {
      // No teardown here, and no reuse of the original 401: only the refresh
      // call can tell a rejected session from an unreachable server. Forward
      // what the refresh reported, verbatim.
      if (refresh.outcome === "refused") {
        return Promise.reject(error);
      }
      return Promise.reject(
        refresh.outcome === "unavailable"
          ? new AxiosError(
              "The session could not be renewed.",
              // What axios itself would pair with each status, so a consumer
              // reading `.code` is not told a 429 came back as a 5xx.
              refresh.status >= 500
                ? AxiosError.ERR_BAD_RESPONSE
                : AxiosError.ERR_BAD_REQUEST,
              originalRequest,
              error.request,
              {
                status: refresh.status,
                statusText: "",
                data: {},
                headers: {},
                config: originalRequest,
              },
            )
          : new AxiosError(
              "The session could not be renewed because the server did not answer.",
              AxiosError.ERR_NETWORK,
              originalRequest,
              error.request,
            ),
      );
    }

    return api(originalRequest);
  },
);
function logValidationError(url: string, error: z.ZodError) {
  console.error("API response validation failed", {
    url,
    issues: error.issues.map((issue) => ({
      code: issue.code,
      path: issue.path.join("."),
    })),
  });
}

function validateResponse<T>(
  schema: z.ZodType<T>,
  url: string,
  responseData: unknown,
): ApiResponse<T> {
  const parsed = schema.safeParse(responseData);

  if (!parsed.success) {
    logValidationError(url, parsed.error);
    return failureResult(normalizeApiError(parsed.error), parsed.error);
  }

  return { success: true, data: parsed.data };
}

/** A failure result with the original exception attached as `cause`. Defined
 * non-enumerable: an Axios/Zod error can hold circular internals, so anything
 * that serializes the result still sees only the sanitized `error`. */
function failureResult(error: ApiError, cause: unknown): ApiResponse<never> {
  const result: ApiResponse<never> = { success: false, error };
  Object.defineProperty(result, "cause", {
    value: cause,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return result;
}

async function validatedRequest<T>(
  schema: z.ZodType<T>,
  url: string,
  request: () => Promise<{ data: unknown }>,
): Promise<ApiResponse<T>> {
  try {
    const response = await request();
    return validateResponse(schema, url, response.data);
  } catch (error) {
    return failureResult(normalizeApiError(error), error);
  }
}

/**
 * What can go in a query string. Scalars only, never `unknown`: an undeclared
 * query name is dropped in silence and its default used, so the call succeeds
 * and answers the wrong question.
 */
type QueryParams = Record<string, string | number | boolean | undefined>;

/**
 * `signal` is TanStack Query's own, and reading it off the `queryFn` context
 * is what makes React Query abort the request when the last observer goes --
 * without it a page left mid-fetch holds its connection to completion.
 */
export function validatedGet<T>(
  schema: z.ZodType<T>,
  url: string,
  params?: QueryParams,
  signal?: AbortSignal,
): Promise<ApiResponse<T>> {
  return validatedRequest(schema, url, () =>
    api.get(url, { params, ...(signal && { signal }) }),
  );
}

export function validatedPost<T>(
  schema: z.ZodType<T>,
  url: string,
  data?: unknown,
  params?: QueryParams,
): Promise<ApiResponse<T>> {
  return validatedRequest(schema, url, () => api.post(url, data, { params }));
}

export function validatedPut<T>(
  schema: z.ZodType<T>,
  url: string,
  data?: unknown,
): Promise<ApiResponse<T>> {
  return validatedRequest(schema, url, () => api.put(url, data));
}

export function validatedDelete<T>(
  schema: z.ZodType<T>,
  url: string,
  params?: QueryParams,
): Promise<ApiResponse<T>> {
  return validatedRequest(schema, url, () => api.delete(url, { params }));
}

export function validatedPatch<T>(
  schema: z.ZodType<T>,
  url: string,
  data?: unknown,
): Promise<ApiResponse<T>> {
  return validatedRequest(schema, url, () => api.patch(url, data));
}

// Feature endpoint functions live with their features (e.g.
// features/players/player-api.ts); this module stays the generic client.
