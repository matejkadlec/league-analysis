import axios, { AxiosError } from "axios";
import { z } from "zod";
import {
  Player,
  PlayerSchema,
  MatchmakingAnalysisResponseSchema,
  MatchmakingAnalysisStatusResponseSchema,
  MatchmakingAnalysisResponse,
  MatchmakingAnalysisStatusResponse,
} from "./schemas";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL;

export const api = axios.create({
  baseURL: `${API_BASE_URL}/api/v1`,
  headers: { "Content-Type": "application/json" },
  timeout: 30000,
});

export interface ApiError {
  message: string;
  code?: string;
  status?: number;
  details?: unknown;
}

export type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: ApiError };

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    // Just pass through errors without logging
    // Error details are handled by individual request handlers
    return Promise.reject(error);
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

// Player API Functions
export async function getPlayerByPuuid(
  puuid: string,
): Promise<ApiResponse<Player>> {
  return validatedGet(PlayerSchema, `/players/${puuid}`);
}

// Player Tracking API Functions
export async function trackPlayer(
  puuid: string,
): Promise<ApiResponse<{ message: string }>> {
  try {
    const response = await api.post(`/players/${puuid}/track`);
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
  platform: string;
  limit?: number;
}

export async function searchPlayerSuggestions(
  params: SearchSuggestionsParams,
): Promise<ApiResponse<Player[]>> {
  const PlayerArraySchema = z.array(PlayerSchema);
  return validatedGet(PlayerArraySchema, "/players/suggestions", {
    q: params.q,
    platform: params.platform,
    ...(params.limit !== undefined && { limit: params.limit }),
  });
}

// Matchmaking Analysis API Functions
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
  analysisId: number,
): Promise<ApiResponse<MatchmakingAnalysisStatusResponse>> {
  return validatedGet(
    MatchmakingAnalysisStatusResponseSchema,
    `/matchmaking-analysis/${analysisId}`,
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

export async function cancelMatchmakingAnalysis(
  analysisId: number,
): Promise<ApiResponse<{ message: string }>> {
  try {
    const response = await api.post(
      `/matchmaking-analysis/${analysisId}/cancel`,
      {},
      {
        timeout: 5000, // 5 second timeout for cancellation
      },
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

export default api;
