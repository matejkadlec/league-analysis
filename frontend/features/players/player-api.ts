import { z } from "zod";

import {
  validatedDelete,
  validatedGet,
  validatedPost,
  type ApiResponse,
} from "@/lib/core/api";
import { Player, PlayerSchema } from "@/lib/core/schemas";
import type { Platform } from "@/lib/core/platform-utils";

const PlayerArraySchema = z.array(PlayerSchema);

export async function trackPlayer(puuid: string): Promise<ApiResponse<Player>> {
  return validatedPost(PlayerSchema, `/players/${puuid}/track`);
}

export async function untrackPlayer(
  puuid: string,
): Promise<ApiResponse<Player>> {
  return validatedDelete(PlayerSchema, `/players/${puuid}/track`);
}

export interface SearchSuggestionsParams {
  q: string;
  // `Platform`, not `string`: both routes validate the query parameter
  // against the backend enum, so these two functions are the last place a
  // "EUW" or a display name can enter the request.
  platform?: Platform;
  limit?: number;
}

export async function searchPlayerSuggestions(
  params: SearchSuggestionsParams,
): Promise<ApiResponse<Player[]>> {
  return validatedGet(PlayerArraySchema, "/players/suggestions", {
    q: params.q,
    ...(params.platform !== undefined && { platform: params.platform }),
    ...(params.limit !== undefined && { limit: params.limit }),
  });
}

export type DiscoverPlayerParams = Record<"game_name" | "tag_line", string> & {
  platform: Platform;
};

export async function discoverPlayer(
  params: DiscoverPlayerParams,
): Promise<ApiResponse<Player>> {
  // The endpoint reads its arguments from the query string, not a body.
  return validatedPost(PlayerSchema, "/players/discover", undefined, params);
}
