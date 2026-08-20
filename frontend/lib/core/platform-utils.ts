/**
 * Platform display name mappings and utilities
 * Maps Riot API platform codes to community-friendly names
 */

export const PLATFORM_DISPLAY_NAMES: Record<string, string> = {
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

/**
 * Get the community-friendly display name for a platform
 * @param platform Platform code (e.g., 'eun1', 'EUN1')
 * @returns Display name (e.g., 'EUNE')
 */
export function getPlatformDisplayName(platform: string): string {
  return (
    PLATFORM_DISPLAY_NAMES[platform.toLowerCase()] || platform.toUpperCase()
  );
}
