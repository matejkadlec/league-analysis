import { z } from "zod";

import {
  validatedDelete,
  validatedGet,
  validatedPost,
  type ApiResponse,
} from "@/lib/core/api";
import { Player, PlayerSchema } from "@/lib/core/schemas";

const TrackingStatusSchema = z.object({ is_tracked: z.boolean() });

export async function trackPlayer(puuid: string): Promise<ApiResponse<Player>> {
  return validatedPost(PlayerSchema, `/players/${puuid}/track`);
}

export async function untrackPlayer(
  puuid: string,
): Promise<ApiResponse<Player>> {
  return validatedDelete(PlayerSchema, `/players/${puuid}/track`);
}

export async function getTrackingStatus(
  puuid: string,
): Promise<ApiResponse<{ is_tracked: boolean }>> {
  return validatedGet(
    TrackingStatusSchema,
    `/players/${puuid}/tracking-status`,
  );
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

export type DiscoverPlayerParams = Record<
  "game_name" | "tag_line" | "platform",
  string
>;

export async function discoverPlayer(
  params: DiscoverPlayerParams,
): Promise<ApiResponse<Player>> {
  // The endpoint reads its arguments from the query string, not a body.
  return validatedPost(PlayerSchema, "/players/discover", undefined, params);
}
