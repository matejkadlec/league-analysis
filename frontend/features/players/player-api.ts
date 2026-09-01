import { z } from "zod";

import {
  validatedDelete,
  validatedGet,
  validatedPost,
  type ApiResponse,
} from "@/lib/core/http/api";
import { Player, PlayerSchema } from "@/lib/core/schemas";
import type { Platform } from "@/lib/core/riot/platform-utils";

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
  // `Platform`, not `string`: the backend validates against its enum, so this
  // is the last place a "EUW" or a display name can enter the request.
  platform?: Platform;
  limit?: number;
}

export async function searchPlayerSuggestions(
  params: SearchSuggestionsParams,
  signal?: AbortSignal,
): Promise<ApiResponse<Player[]>> {
  return validatedGet(PlayerArraySchema, "/players/suggestions", {
    params: {
      q: params.q,
      ...(params.platform !== undefined && { platform: params.platform }),
      ...(params.limit !== undefined && { limit: params.limit }),
    },
    signal,
  });
}

export type DiscoverPlayerParams = Record<"game_name" | "tag_line", string> & {
  platform: Platform;
};

export async function discoverPlayer(
  params: DiscoverPlayerParams,
): Promise<ApiResponse<Player>> {
  // Query string args, not a body -- hence `undefined` here. Named one by one,
  // not spread: a `{ params }` shorthand would hide all three from the contract test.
  return validatedPost(PlayerSchema, "/players/discover", undefined, {
    params: {
      game_name: params.game_name,
      tag_line: params.tag_line,
      platform: params.platform,
    },
  });
}
