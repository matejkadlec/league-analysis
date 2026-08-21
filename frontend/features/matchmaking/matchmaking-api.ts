import {
  validatedDelete,
  validatedGet,
  validatedPost,
  type ApiResponse,
} from "@/lib/core/api";
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
): Promise<ApiResponse<MatchmakingAnalysisResponse>> {
  return validatedPost(
    MatchmakingAnalysisResponseSchema,
    "/matchmaking-analysis/start",
    { puuid } satisfies MatchmakingAnalysisRequest,
  );
}

export async function getMatchmakingAnalysisStatus(
  puuid: string,
  createdAt: string,
): Promise<ApiResponse<MatchmakingAnalysisResponse>> {
  return validatedGet(
    MatchmakingAnalysisResponseSchema,
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
): Promise<ApiResponse<MessageResponse>> {
  return validatedDelete(
    MessageResponseSchema,
    `/matchmaking-analysis/player/${puuid}/cancel`,
    { created_at: createdAt },
  );
}

export async function deleteMatchmakingAnalysisRecord(
  puuid: string,
  createdAt: string,
): Promise<ApiResponse<MessageResponse>> {
  return validatedDelete(
    MessageResponseSchema,
    `/matchmaking-analysis/player/${puuid}/analysis`,
    { created_at: createdAt },
  );
}
