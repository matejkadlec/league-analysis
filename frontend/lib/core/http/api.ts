import axios, {
  AxiosError,
  AxiosRequestConfig,
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
import { notifyRiotCredentialHealthUpdated } from "../riot/riot-credential-health-events";
import { refreshAccessToken } from "@/lib/session/token-manager";

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
 * The `validated*` helpers resolve rather than reject, so a caller reading
 * `.data` alone renders failure as an empty state and never toasts.
 */
export function unwrap<T>(result: ApiResponse<T>): T {
  if (!result.success) {
    throw new ApiRequestError(result.error, { cause: result.cause });
  }
  return result.data;
}

/**
 * `unwrap`, except a 404 is an ordinary empty state for resources that exist
 * only once something has happened. Every other status still throws.
 */
export function unwrapOr404<T, F>(result: ApiResponse<T>, fallback: F): T | F {
  if (!result.success && result.error.status === 404) {
    return fallback;
  }
  return unwrap(result);
}

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
      // Only the refresh call can tell a rejected session from an unreachable
      // server, so forward what it reported rather than the original 401.
      if (refresh.outcome === "refused") {
        return Promise.reject(error);
      }
      if (refresh.outcome === "unavailable") {
        return Promise.reject(
          new AxiosError(
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
          ),
        );
      }

      const unreachable = new AxiosError(
        "The session could not be renewed because the server did not answer.",
        AxiosError.ERR_NETWORK,
        originalRequest,
        error.request,
      );
      // AxiosError has no ErrorOptions overload and types `cause` as Error,
      // so the value refresh caught is attached afterwards rather than lost.
      if (refresh.cause instanceof Error) {
        unreachable.cause = refresh.cause;
      }
      return Promise.reject(unreachable);
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

/** `cause` is non-enumerable: an Axios/Zod error holds circular internals, so
 * anything serializing the result sees only the sanitized `error`. */
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

/**
 * Scalars only, never `unknown`: an undeclared query name is dropped in
 * silence and its default used, so the call answers the wrong question.
 */
type QueryParams = Record<string, string | number | boolean | undefined>;

/**
 * `signal` is TanStack Query's own: without it a page left mid-fetch holds its
 * connection to completion.
 */
export type RequestOptions = {
  // Explicitly `| undefined`: under `exactOptionalPropertyTypes` a caller
  // forwarding an optional `signal` may not omit the key, only pass it unset.
  params?: QueryParams | undefined;
  signal?: AbortSignal | undefined;
};

async function validatedRequest<T>(
  schema: z.ZodType<T>,
  url: string,
  { params, signal }: RequestOptions,
  request: (config: AxiosRequestConfig) => Promise<{ data: unknown }>,
): Promise<ApiResponse<T>> {
  try {
    const response = await request({ params, ...(signal && { signal }) });
    return validateResponse(schema, url, response.data);
  } catch (error) {
    return failureResult(normalizeApiError(error), error);
  }
}

export function validatedGet<T>(
  schema: z.ZodType<T>,
  url: string,
  options: RequestOptions = {},
): Promise<ApiResponse<T>> {
  return validatedRequest(schema, url, options, (config) =>
    api.get(url, config),
  );
}

export function validatedPost<T>(
  schema: z.ZodType<T>,
  url: string,
  data?: unknown,
  options: RequestOptions = {},
): Promise<ApiResponse<T>> {
  return validatedRequest(schema, url, options, (config) =>
    api.post(url, data, config),
  );
}

export function validatedPut<T>(
  schema: z.ZodType<T>,
  url: string,
  data?: unknown,
  options: RequestOptions = {},
): Promise<ApiResponse<T>> {
  return validatedRequest(schema, url, options, (config) =>
    api.put(url, data, config),
  );
}

export function validatedDelete<T>(
  schema: z.ZodType<T>,
  url: string,
  options: RequestOptions = {},
): Promise<ApiResponse<T>> {
  return validatedRequest(schema, url, options, (config) =>
    api.delete(url, config),
  );
}

export function validatedPatch<T>(
  schema: z.ZodType<T>,
  url: string,
  data?: unknown,
  options: RequestOptions = {},
): Promise<ApiResponse<T>> {
  return validatedRequest(schema, url, options, (config) =>
    api.patch(url, data, config),
  );
}

// Feature endpoint functions live with their features (e.g.
// features/players/player-api.ts); this module stays the generic client.
