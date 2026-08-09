import axios, {
  AxiosError,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";
import { z } from "zod";
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
import {
  notifyApiKeyInvalid,
  notifyApiKeyValid,
} from "./api-key-status-context";
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

export interface ApiError {
  message: string;
  code?: string;
  status?: number;
  details?: unknown;
}

export type ApiResponse<T> =
  { success: true; data: T } | { success: false; error: ApiError };

// Endpoints that use the Riot API (when these succeed, API key is valid)
const RIOT_API_ENDPOINTS = [
  "/players/add-tracked",
  "/players/search",
  "/matches/sync",
  "/refresh-league",
  "/auth/connect-riot-account",
];

function isRiotApiEndpoint(url: string | undefined): boolean {
  if (!url) return false;
  return RIOT_API_ENDPOINTS.some((endpoint) => url.includes(endpoint));
}

// Standard error code returned by backend when Riot API key is invalid
const RIOT_API_KEY_INVALID_CODE = "RIOT_API_KEY_INVALID";

export type RiotApiKeySignal = "invalid" | "valid" | null;

export function getRiotApiKeySignal(
  url: string | undefined,
  responseData: unknown,
): RiotApiKeySignal {
  const data =
    typeof responseData === "object" && responseData !== null
      ? (responseData as Record<string, unknown>)
      : null;
  if (data?.error_code === RIOT_API_KEY_INVALID_CODE) {
    return "invalid";
  }

  if (!url) {
    return null;
  }

  if (url.includes("/matchmaking-analysis")) {
    if (url.includes("/check-matches")) {
      return "valid";
    }
    if (url.includes("/status") && data?.status === "completed") {
      return "valid";
    }
    return null;
  }

  return isRiotApiEndpoint(url) ? "valid" : null;
}

function isApiKeyError(response: AxiosResponse | undefined): boolean {
  if (!response) return false;
  const detail = response.data?.detail;
  // Check for our specific API key error code first (most reliable)
  if (detail === RIOT_API_KEY_INVALID_CODE) {
    return true;
  }
  // Fallback: Check for API key error messages in response
  return (
    typeof detail === "string" &&
    (detail.toLowerCase().includes("api key") ||
      detail.toLowerCase().includes("unauthorized") ||
      detail.toLowerCase().includes("expired"))
  );
}

api.interceptors.response.use(
  (response: AxiosResponse) => {
    const apiKeySignal = getRiotApiKeySignal(
      response.config.url,
      response.data,
    );
    if (apiKeySignal === "invalid") {
      notifyApiKeyInvalid();
    } else if (apiKeySignal === "valid") {
      notifyApiKeyValid();
    }
    return response;
  },
  async (error: AxiosError) => {
    // Check ALL responses for API key errors (503 with specific code)
    // This ensures any endpoint that internally uses Riot API will trigger the header
    if (isApiKeyError(error.response)) {
      notifyApiKeyInvalid();
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
function formatError(error: unknown): ApiError {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const data = error.response?.data;
    const detail = data?.detail;

    if (status === 404 && typeof detail === "string") {
      return {
        message: detail,
        code: "PLAYER_NOT_FOUND",
        status: 404,
        details: data,
      };
    }

    const message =
      typeof detail === "string"
        ? detail
        : data?.message
          ? data.message
          : error.message || "An unknown API error occurred";

    return {
      message,
      code: error.code,
      status: status,
      details: data,
    };
  }

  if (error instanceof z.ZodError) {
    return {
      message: "Data validation failed",
      code: "VALIDATION_ERROR",
      details: error.issues,
    };
  }

  if (error instanceof Error) {
    return { message: error.message, code: "UNKNOWN_ERROR" };
  }

  return { message: "An unknown error occurred", code: "UNKNOWN_ERROR" };
}

function logValidationError(url: string, data: unknown, error: z.ZodError) {
  console.error("🔴 ZOD VALIDATION FAILED 🔴");
  console.error("URL:", url);
  console.error("Response:", data);
  console.error("Errors:", JSON.stringify(error.format(), null, 2));
}

async function validateResponse<T>(
  schema: z.ZodType<T>,
  url: string,
  responseData: unknown,
): Promise<ApiResponse<T>> {
  const parsed = schema.safeParse(responseData);

  if (!parsed.success) {
    logValidationError(url, responseData, parsed.error);
    return { success: false, error: formatError(parsed.error) };
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
    return { success: false, error: formatError(error) };
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
    return { success: false, error: formatError(error) };
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
    return { success: false, error: formatError(error) };
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
    return { success: false, error: formatError(error) };
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
    return { success: false, error: formatError(error) };
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
      error: formatError(error),
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
      error: formatError(error),
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
      error: formatError(error),
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
      error: formatError(error),
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
      error: formatError(error),
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
      error: formatError(error),
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
      error: formatError(error),
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
      error: formatError(error),
    };
  }
}

export interface ConnectRiotAccountRequest {
  game_name: string;
  tag_line: string;
  platform: string;
}

export async function connectRiotAccount(
  data: ConnectRiotAccountRequest,
): Promise<ApiResponse<{ puuid: string; riot_account_connected: boolean }>> {
  try {
    const response = await api.post("/auth/connect-riot-account", data);
    return {
      success: true,
      data: response.data,
    };
  } catch (error) {
    return {
      success: false,
      error: formatError(error),
    };
  }
}

export default api;
