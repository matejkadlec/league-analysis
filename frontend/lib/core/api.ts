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
import {
  Player,
  PlayerSchema,
  MatchmakingAnalysisResponseSchema,
  MatchmakingAnalysisStatusResponseSchema,
  MatchmakingAnalysisHistoryResponseSchema,
  MatchmakingAnalysisResponse,
  MatchmakingAnalysisStatusResponse,
  MatchmakingAnalysisHistoryResponse,
} from "./schemas";
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

// Player API Functions
export async function getPlayerByPuuid(
  puuid: string,
): Promise<ApiResponse<Player>> {
  return validatedGet(PlayerSchema, `/players/${puuid}`);
}

// Player Tracking API Functions
export async function trackPlayer(puuid: string): Promise<ApiResponse<Player>> {
  try {
    const response = await api.post(`/players/${puuid}/track`);
    return validateResponse(
      PlayerSchema,
      `/players/${puuid}/track`,
      response.data,
    );
  } catch (error) {
    return {
      success: false,
      error: normalizeApiError(error),
    };
  }
}

export async function untrackPlayer(
  puuid: string,
): Promise<ApiResponse<{ message: string }>> {
  try {
    const response = await api.delete(`/players/${puuid}/track`);
    return {
      success: true,
      data: response.data,
    };
  } catch (error) {
    return {
      success: false,
      error: normalizeApiError(error),
    };
  }
}

export async function getTrackingStatus(
  puuid: string,
): Promise<ApiResponse<{ is_tracked: boolean }>> {
  try {
    const response = await api.get(`/players/${puuid}/tracking-status`);
    return {
      success: true,
      data: response.data,
    };
  } catch (error) {
    return {
      success: false,
      error: normalizeApiError(error),
    };
  }
}

export async function getTrackedPlayers(): Promise<
  ApiResponse<{ players: unknown[] }>
> {
  try {
    const response = await api.get(`/players/tracked/list`);
    return {
      success: true,
      data: response.data,
    };
  } catch (error) {
    return {
      success: false,
      error: normalizeApiError(error),
    };
  }
}

export interface AddTrackedPlayerParams {
  game_name: string;
  tag_line: string;
  platform: string;
}

export async function addTrackedPlayer(
  params: AddTrackedPlayerParams,
): Promise<ApiResponse<unknown>> {
  try {
    const response = await api.post(`/players/add-tracked`, null, { params });
    return {
      success: true,
      data: response.data,
    };
  } catch (error) {
    return {
      success: false,
      error: normalizeApiError(error),
    };
  }
}

export interface SearchSuggestionsParams {
  q: string;
  platform?: string;
  limit?: number;
}

export async function searchPlayerSuggestions(
  params: SearchSuggestionsParams,
): Promise<ApiResponse<Player[]>> {
  const PlayerArraySchema = z.array(PlayerSchema);
  return validatedGet(PlayerArraySchema, "/players/suggestions", {
    q: params.q,
    ...(params.platform !== undefined && { platform: params.platform }),
    ...(params.limit !== undefined && { limit: params.limit }),
  });
}

export interface DiscoverPlayerParams {
  game_name: string;
  tag_line: string;
  platform: string;
}

export async function discoverPlayer(
  params: DiscoverPlayerParams,
): Promise<ApiResponse<Player>> {
  try {
    const response = await api.post("/players/discover", null, { params });
    const parsed = PlayerSchema.safeParse(response.data);
    if (!parsed.success) {
      return {
        success: false,
        error: {
          message: "The player response was invalid.",
          code: "INVALID_RESPONSE",
          kind: "invalid-response",
        },
      };
    }
    return { success: true, data: parsed.data };
  } catch (error) {
    return { success: false, error: normalizeApiError(error) };
  }
}

// Matchmaking Analysis API Functions
export async function checkPlayerMatches(
  puuid: string,
): Promise<
  ApiResponse<
    | { success: boolean; matches_found: number }
    | { message: string; matches_found: number; matches_required: number }
  >
> {
  try {
    const response = await api.post("/matchmaking-analysis/check-matches", {
      puuid,
    });
    return {
      success: true,
      data: response.data,
    };
  } catch (error) {
    return {
      success: false,
      error: normalizeApiError(error),
    };
  }
}

export async function startMatchmakingAnalysis(
  puuid: string,
): Promise<ApiResponse<MatchmakingAnalysisResponse>> {
  return validatedPost(
    MatchmakingAnalysisResponseSchema,
    "/matchmaking-analysis/start",
    {
      puuid,
    },
  );
}

export async function getMatchmakingAnalysisStatus(
  puuid: string,
  createdAt: string,
): Promise<ApiResponse<MatchmakingAnalysisStatusResponse>> {
  return validatedGet(
    MatchmakingAnalysisStatusResponseSchema,
    `/matchmaking-analysis/player/${puuid}/status`,
    { created_at: createdAt },
  );
}

export async function getLatestMatchmakingAnalysis(
  puuid: string,
): Promise<ApiResponse<MatchmakingAnalysisResponse>> {
  return validatedGet(
    MatchmakingAnalysisResponseSchema,
    `/matchmaking-analysis/player/${puuid}`,
  );
}

export async function getLatestCompletedMatchmakingAnalysis(
  puuid: string,
): Promise<ApiResponse<MatchmakingAnalysisResponse>> {
  return validatedGet(
    MatchmakingAnalysisResponseSchema,
    `/matchmaking-analysis/player/${puuid}/latest-completed`,
  );
}

export async function getMatchmakingAnalysisHistory(
  puuid: string,
  limit: number = 20,
): Promise<ApiResponse<MatchmakingAnalysisHistoryResponse>> {
  return validatedGet(
    MatchmakingAnalysisHistoryResponseSchema,
    `/matchmaking-analysis/player/${puuid}/history`,
    { limit },
  );
}

export async function cancelMatchmakingAnalysis(
  puuid: string,
  createdAt: string,
): Promise<ApiResponse<{ success: boolean; message: string }>> {
  try {
    const response = await api.delete(
      `/matchmaking-analysis/player/${puuid}/cancel`,
      { params: { created_at: createdAt } },
    );
    return {
      success: true,
      data: response.data,
    };
  } catch (error) {
    return {
      success: false,
      error: normalizeApiError(error),
    };
  }
}

export async function deleteMatchmakingAnalysisRecord(
  puuid: string,
  createdAt: string,
): Promise<ApiResponse<{ success: boolean; message: string }>> {
  try {
    const response = await api.delete(
      `/matchmaking-analysis/player/${puuid}/analysis`,
      { params: { created_at: createdAt } },
    );
    return {
      success: true,
      data: response.data,
    };
  } catch (error) {
    return {
      success: false,
      error: normalizeApiError(error),
    };
  }
}

export default api;
