import type { ApiError } from "@/lib/core/api";
import {
  type Platform,
  getPlatformDisplayName,
} from "@/lib/core/platform-utils";

import type { RiotIdParts } from "./riot-id";

export function playerNotFoundMessage(
  riotId: RiotIdParts,
  platform: Platform,
): string {
  return `Player ${riotId.gameName}#${riotId.tagLine} wasn't found on server ${getPlatformDisplayName(platform)}.`;
}

export type PlayerTrackingFailureKind =
  | "not-found"
  | "rate-limited"
  | "api-key"
  | "unexpected";

/**
 * Classify a failed player lookup from the already-normalized error.
 * `normalizeApiError` has read the status and the structured code, so this
 * only names the four outcomes the selector words differently -- no second
 * error type, and no sniffing the message text for "api key".
 */
export function playerTrackingFailureKind(
  error: ApiError,
): PlayerTrackingFailureKind {
  if (error.kind === "not-found" || error.code === "PLAYER_NOT_FOUND") {
    return "not-found";
  }
  if (error.kind === "rate-limit") {
    return "rate-limited";
  }
  if (error.code === "RIOT_API_KEY_INVALID") {
    return "api-key";
  }
  return "unexpected";
}
