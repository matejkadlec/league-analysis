import { z } from "zod";

import {
  api,
  normalizeApiError,
  validatedGet,
  validatedPost,
  type ApiResponse,
} from "@/lib/core/api";
import { Player, PlayerSchema } from "@/lib/core/schemas";

export async function trackPlayer(puuid: string): Promise<ApiResponse<Player>> {
  return validatedPost(PlayerSchema, `/players/${puuid}/track`);
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
