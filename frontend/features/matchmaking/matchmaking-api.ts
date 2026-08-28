import {
  validatedDelete,
  validatedGet,
  validatedPost,
  type ApiResponse,
} from "@/lib/core/http/api";
import {
  MatchmakingAnalysisHistoryResponse,
  MatchmakingAnalysisHistoryResponseSchema,
  MatchmakingAnalysisRequest,
  MatchmakingAnalysisResponse,
  MatchmakingAnalysisResponseSchema,
  MessageResponse,
  MessageResponseSchema,
} from "@/lib/core/schemas";

export async function startMatchmakingAnalysis(
  puuid: string,
  matchCount: number,
  endDate: string | null,
): Promise<ApiResponse<MatchmakingAnalysisResponse>> {
  return validatedPost(
    MatchmakingAnalysisResponseSchema,
    "/matchmaking-analysis/start",
    {
      puuid,
      match_count: matchCount,
      end_date: endDate,
    } satisfies MatchmakingAnalysisRequest,
  );
}

export async function getMatchmakingAnalysisStatus(
  puuid: string,
  createdAt: string,
  signal?: AbortSignal,
): Promise<ApiResponse<MatchmakingAnalysisResponse>> {
  return validatedGet(
    MatchmakingAnalysisResponseSchema,
    `/matchmaking-analysis/player/${puuid}/status`,
    { params: { created_at: createdAt }, signal },
  );
}

export async function getLatestMatchmakingAnalysis(
  puuid: string,
  signal?: AbortSignal,
): Promise<ApiResponse<MatchmakingAnalysisResponse>> {
  return validatedGet(
    MatchmakingAnalysisResponseSchema,
    `/matchmaking-analysis/player/${puuid}`,
    { signal },
  );
}

export async function getLatestCompletedMatchmakingAnalysis(
  puuid: string,
  signal?: AbortSignal,
): Promise<ApiResponse<MatchmakingAnalysisResponse>> {
  return validatedGet(
    MatchmakingAnalysisResponseSchema,
    `/matchmaking-analysis/player/${puuid}/latest-completed`,
    { signal },
  );
}

export async function getMatchmakingAnalysisHistory(
  puuid: string,
  limit: number = 20,
  signal?: AbortSignal,
): Promise<ApiResponse<MatchmakingAnalysisHistoryResponse>> {
  return validatedGet(
    MatchmakingAnalysisHistoryResponseSchema,
    `/matchmaking-analysis/player/${puuid}/history`,
    { params: { limit }, signal },
  );
}

export async function cancelMatchmakingAnalysis(
  puuid: string,
  createdAt: string,
): Promise<ApiResponse<MessageResponse>> {
  return validatedDelete(
    MessageResponseSchema,
    `/matchmaking-analysis/player/${puuid}/cancel`,
    { params: { created_at: createdAt } },
  );
}

export async function deleteMatchmakingAnalysisRecord(
  puuid: string,
  createdAt: string,
): Promise<ApiResponse<MessageResponse>> {
  return validatedDelete(
    MessageResponseSchema,
    `/matchmaking-analysis/player/${puuid}/analysis`,
    { params: { created_at: createdAt } },
  );
}
