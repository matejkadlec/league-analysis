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
export const PLATFORM_DISPLAY_NAMES = {
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
} as const satisfies Record<string, string>;

/**
 * Every platform code the API accepts. `PlayerSchema` parses against these
 * keys, so a value that reached React is one of them -- which is why
 * `getPlatformDisplayName` needs neither a lowercasing pass nor a fallback.
 */
export type Platform = keyof typeof PLATFORM_DISPLAY_NAMES;

export const PLATFORMS = Object.keys(PLATFORM_DISPLAY_NAMES) as [
  Platform,
  ...Platform[],
];

/**
 * Narrows a string to a platform code.
 *
 * The one place a plain string still becomes a `Platform`: Radix's `Select`
 * types `onValueChange` as `(value: string) => void`, so the picker cannot
 * hand back the key type of the table it renders from.
 */
export function isPlatform(value: string): value is Platform {
  return value in PLATFORM_DISPLAY_NAMES;
}

/** The community-friendly display name for a platform, e.g. `eun1` -> `EUNE`. */
export function getPlatformDisplayName(platform: Platform): string {
  return PLATFORM_DISPLAY_NAMES[platform];
}
