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

export type PlayerTrackingFailureKind =
  | "not-found"
  | "rate-limited"
  | "api-key"
  | "unexpected";

export class PlayerTrackingError extends Error {
  constructor(
    public readonly kind: PlayerTrackingFailureKind,
    message: string,
  ) {
    super(message);
    this.name = "PlayerTrackingError";
  }
}

export function getServerDisplayName(platform: string): string {
  return SERVER_DISPLAY_NAMES[platform.toLowerCase()] ?? platform.toUpperCase();
}

export function playerNotFoundMessage(
  riotId: RiotIdParts,
  platform: string,
): string {
  return `Player ${riotId.gameName}#${riotId.tagLine} wasn't found on server ${getServerDisplayName(platform)}.`;
}

export function toPlayerTrackingError(
  error: ApiError,
  riotId: RiotIdParts,
  platform: string,
): PlayerTrackingError {
  const message = error.message.trim();
  const normalizedMessage = message.toLowerCase();

  if (
    error.status === 404 ||
    error.code === "PLAYER_NOT_FOUND" ||
    normalizedMessage === "internal server error adding tracked player"
  ) {
    return new PlayerTrackingError(
      "not-found",
      playerNotFoundMessage(riotId, platform),
    );
  }

  if (error.status === 429) {
    return new PlayerTrackingError("rate-limited", message);
  }

  if (
    error.code === "RIOT_API_KEY_INVALID" ||
    normalizedMessage.includes("api key") ||
    normalizedMessage.includes("unauthorized")
  ) {
    return new PlayerTrackingError("api-key", message);
  }

  return new PlayerTrackingError("unexpected", message);
}
