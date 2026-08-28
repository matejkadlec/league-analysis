/**
 * Every platform the API accepts, and what to call it on screen. The key order
 * IS the order of the server picker, so alphabetising would move EUNE out of
 * first place. `tests/api-contract-alignment.test.ts` pins the key set.
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
 * Narrows a string to a platform code -- the one place a plain string still
 * becomes a `Platform`, because Radix types `Select`'s `onValueChange` as
 * `(value: string) => void`.
 */
export function isPlatform(value: string): value is Platform {
  return value in PLATFORM_DISPLAY_NAMES;
}

/** The community-friendly display name for a platform, e.g. `eun1` -> `EUNE`. */
export function getPlatformDisplayName(platform: Platform): string {
  return PLATFORM_DISPLAY_NAMES[platform];
}
