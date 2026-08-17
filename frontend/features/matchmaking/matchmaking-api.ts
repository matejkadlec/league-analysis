import { z } from "zod";

import {
  validatedDelete,
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

const AnalysisActionResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

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
  return validatedDelete(
    AnalysisActionResponseSchema,
    `/matchmaking-analysis/player/${puuid}/cancel?${new URLSearchParams({ created_at: createdAt }).toString()}`,
  );
}

export async function deleteMatchmakingAnalysisRecord(
  puuid: string,
  createdAt: string,
): Promise<ApiResponse<{ success: boolean; message: string }>> {
  return validatedDelete(
    AnalysisActionResponseSchema,
    `/matchmaking-analysis/player/${puuid}/analysis?${new URLSearchParams({ created_at: createdAt }).toString()}`,
  );
}
