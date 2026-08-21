import axios, {
  AxiosError,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";
import { z } from "zod";
import { ApiRequestError, normalizeApiError } from "./api-error";
export {
  ApiRequestError,
  apiErrorMessage,
  normalizeApiError,
  type ApiError,
  type ApiErrorKind,
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
  { success: true; data: T } | { success: false; error: ApiError };

/**
 * Unwrap an `ApiResponse` inside a query or mutation function.
 *
 * The `validated*` helpers resolve with `{ success: false }` rather than
 * rejecting, so a caller reading only `.data` turns a failed request into a
 * silent empty state and never reaches the `QueryCache` error toast that
 * `frontend/CLAUDE.md` makes the floor. Throwing here keeps that contract and
 * carries the `ApiError` through, so the toast can name the failure.
 */
export function unwrap<T>(result: ApiResponse<T>): T {
  if (!result.success) {
    throw new ApiRequestError(result.error);
  }
  return result.data;
}

/**
 * `unwrap`, except a 404 is an ordinary empty state rather than a failure.
 *
 * Several resources only exist once something has happened -- a player who has
 * never been analysed, a deployment with no key saved yet -- so their absence
 * is what the surface is there to render. Every other status still throws, so
 * a real failure keeps reaching the `QueryCache` toast.
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
      // Teardown belongs to the refresh call, which is the only thing that
      // knows whether the server rejected the session or was simply
      // unreachable. Clearing the hint from here left React still believing it
      // was signed in, and that disagreement rendered as a blank page.
      //
      // What it reports is forwarded verbatim, because the original 401 is
      // true of the expired access token and of nothing else. Passing it on
      // regardless labelled a redeploy `kind: "authentication"`, and every
      // reader believed it: `queryErrorToast` swallowed the toast because "the
      // auth gate already redirects on these", while the gate did not redirect
      // -- the hint was still standing. No message, no navigation, nothing.
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
function logValidationError(url: string, data: unknown, error: z.ZodError) {
  void data;
  console.error("API response validation failed", {
    url,
    issues: error.issues.map((issue) => ({
      code: issue.code,
      path: issue.path.join("."),
    })),
  });
}

async function validateResponse<T>(
  schema: z.ZodType<T>,
  url: string,
  responseData: unknown,
): Promise<ApiResponse<T>> {
  const parsed = schema.safeParse(responseData);

  if (!parsed.success) {
    logValidationError(url, responseData, parsed.error);
    return { success: false, error: normalizeApiError(parsed.error) };
  }

  return { success: true, data: parsed.data };
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
    return { success: false, error: normalizeApiError(error) };
  }
}

export function validatedGet<T>(
  schema: z.ZodType<T>,
  url: string,
  params?: Record<string, unknown>,
): Promise<ApiResponse<T>> {
  return validatedRequest(schema, url, () => api.get(url, { params }));
}

export function validatedPost<T>(
  schema: z.ZodType<T>,
  url: string,
  data?: unknown,
  params?: Record<string, unknown>,
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
  params?: Record<string, unknown>,
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

export default api;
