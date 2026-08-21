/**
 * Platform display name mappings and utilities
 * Maps Riot API platform codes to community-friendly names
 */

/**
 * Every platform the API accepts, and what to call it on screen.
 *
 * The key order IS the order of the server picker -- `player-selector.tsx`
 * maps this object rather than keeping a second list, which is what the two
 * used to be. Alphabetising it would silently move EUNE out of first place, so
 * do not tidy it.
 *
 * `tests/api-contract-alignment.test.ts` asserts the key set equals the
 * `Platform` enum in the OpenAPI document, so a platform added on the backend
 * fails the gate here rather than falling through to `platform.toUpperCase()`.
 */
export const PLATFORM_DISPLAY_NAMES: Record<string, string> = {
  eun1: "EUNE",
  euw1: "EUW",
  na1: "NA",
  kr: "KR",
  br1: "BR",
  jp1: "JP",
  la1: "LAN",
  la2: "LAS",
  oc1: "OCE",
  tr1: "TR",
  ru: "RU",
  ph2: "PH",
  sg2: "SG",
  th2: "TH",
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
