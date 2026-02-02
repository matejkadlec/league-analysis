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

/**
 * Server flags for display
 */
export const SERVER_FLAGS: Record<string, string> = {
  euw1: "🇪🇺",
  eun1: "🇪🇺",
  na1: "🇺🇸",
  kr: "🇰🇷",
  tr1: "🇹🇷",
  br1: "🇧🇷",
  la1: "🇲🇽",
  la2: "🇦🇷",
  oc1: "🇦🇺",
  ru: "🇷🇺",
  jp1: "🇯🇵",
  tw2: "🇹🇼",
  vn2: "🇻🇳",
  ph2: "🇵🇭",
  sg2: "🇸🇬",
  th2: "🇹🇭",
};

/**
 * Get flag emoji for a platform
 */
export function getPlatformFlag(platform: string): string {
  return SERVER_FLAGS[platform.toLowerCase()] || "🌐";
}
