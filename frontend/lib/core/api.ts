import axios, {
  AxiosError,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";
import { z } from "zod";
import { normalizeApiError } from "./api-error";
export {
  apiErrorMessage,
  normalizeApiError,
  type ApiError,
  type ApiErrorKind,
} from "./api-error";
import type { ApiError } from "./api-error";
import { notifyRiotCredentialHealthUpdated } from "./riot-credential-health-events";
import {
  getAccessToken,
  refreshAccessToken,
  removeAuthTokens,
} from "@/features/auth/utils/token-manager";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL;

export const api = axios.create({
  baseURL: `${API_BASE_URL}/api/v1`,
  headers: { "Content-Type": "application/json" },
  timeout: 30000,
});

// Add auth token to all requests if available
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export type ApiResponse<T> =
  { success: true; data: T } | { success: false; error: ApiError };

// Standard error code returned by backend when Riot API key is invalid
const RIOT_API_KEY_INVALID_CODE = "RIOT_API_KEY_INVALID";

export type RiotApiKeySignal = "refresh" | null;

export function getRiotApiKeySignal(responseData: unknown): RiotApiKeySignal {
  const data =
    typeof responseData === "object" && responseData !== null
      ? (responseData as Record<string, unknown>)
      : null;
  return data?.error_code === RIOT_API_KEY_INVALID_CODE ? "refresh" : null;
}

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
    const apiKeySignal = getRiotApiKeySignal(response.data);
    if (apiKeySignal === "refresh") {
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
    const refreshedToken = await refreshAccessToken();
    if (!refreshedToken) {
      removeAuthTokens();
      return Promise.reject(error);
    }

    if (typeof originalRequest.headers.set === "function") {
      originalRequest.headers.set("Authorization", `Bearer ${refreshedToken}`);
    } else {
      (
        originalRequest.headers as unknown as Record<string, string>
      ).Authorization = `Bearer ${refreshedToken}`;
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

export async function validatedGet<T>(
  schema: z.ZodType<T>,
  url: string,
  params?: Record<string, unknown>,
): Promise<ApiResponse<T>> {
  try {
    const response = await api.get(url, { params });
    return validateResponse(schema, url, response.data);
  } catch (error) {
    return { success: false, error: normalizeApiError(error) };
  }
}

export async function validatedPost<T>(
  schema: z.ZodType<T>,
  url: string,
  data?: unknown,
): Promise<ApiResponse<T>> {
  try {
    const response = await api.post(url, data);
    return validateResponse(schema, url, response.data);
  } catch (error) {
    return { success: false, error: normalizeApiError(error) };
  }
}

export async function validatedPut<T>(
  schema: z.ZodType<T>,
  url: string,
  data?: unknown,
): Promise<ApiResponse<T>> {
  try {
    const response = await api.put(url, data);
    return validateResponse(schema, url, response.data);
  } catch (error) {
    return { success: false, error: normalizeApiError(error) };
  }
}

export async function validatedDelete<T>(
  schema: z.ZodType<T>,
  url: string,
): Promise<ApiResponse<T>> {
  try {
    const response = await api.delete(url);
    return validateResponse(schema, url, response.data);
  } catch (error) {
    return { success: false, error: normalizeApiError(error) };
  }
}

export async function validatedPatch<T>(
  schema: z.ZodType<T>,
  url: string,
  data?: unknown,
): Promise<ApiResponse<T>> {
  try {
    const response = await api.patch(url, data);
    return validateResponse(schema, url, response.data);
  } catch (error) {
    return { success: false, error: normalizeApiError(error) };
  }
}

// Feature endpoint functions live with their features (e.g.
// features/players/player-api.ts); this module stays the generic client.

export default api;
