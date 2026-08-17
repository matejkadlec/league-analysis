import type { ApiError } from "@/lib/core/api";

import type { RiotIdParts } from "./riot-id";

const SERVER_DISPLAY_NAMES: Record<string, string> = {
  br1: "BR",
  eun1: "EUNE",
  euw1: "EUW",
  jp1: "JP",
  kr: "KR",
  la1: "LAN",
  la2: "LAS",
  na1: "NA",
  oc1: "OCE",
  ph2: "PH",
  ru: "RU",
  sg2: "SG",
  th2: "TH",
  tr1: "TR",
  tw2: "TW",
  vn2: "VN",
};

export function getServerDisplayName(platform: string): string {
  return SERVER_DISPLAY_NAMES[platform.toLowerCase()] ?? platform.toUpperCase();
}

export function playerNotFoundMessage(
  riotId: RiotIdParts,
  platform: string,
): string {
  return `Player ${riotId.gameName}#${riotId.tagLine} wasn't found on server ${getServerDisplayName(platform)}.`;
}

export type PlayerTrackingFailureKind =
  | "not-found"
  | "rate-limited"
  | "api-key"
  | "unexpected";

/**
 * Classify a failed player lookup from the error the API layer already
 * normalized. `normalizeApiError` has done the work of reading the status and
 * the structured code, so this only has to name the four outcomes the selector
 * words differently — no second error type, and no sniffing the message text
 * for "api key", which the backend now states as `RIOT_API_KEY_INVALID`.
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
