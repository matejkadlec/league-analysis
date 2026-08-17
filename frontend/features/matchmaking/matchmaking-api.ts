import {
  api,
  normalizeApiError,
  validatedGet,
  validatedPost,
  type ApiResponse,
} from "@/lib/core/api";
import {
  MatchmakingAnalysisHistoryResponse,
  MatchmakingAnalysisHistoryResponseSchema,
  MatchmakingAnalysisResponse,
  MatchmakingAnalysisResponseSchema,
  MatchmakingAnalysisStatusResponse,
  MatchmakingAnalysisStatusResponseSchema,
} from "@/lib/core/schemas";

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
