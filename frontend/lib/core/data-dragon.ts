/**
 * Data Dragon CDN utilities for League of Legends assets.
 *
 * Data Dragon is Riot's official CDN for game assets like champion icons,
 * item images, summoner spell icons, etc.
 */

// Used only when Riot's version manifest is temporarily unavailable. The root
// layout normally resolves the latest version and provides it to client code.
export const DDRAGON_FALLBACK_VERSION = "16.15.1";

const DDRAGON_IMAGE_BASE_URL = "https://ddragon.leagueoflegends.com/cdn/img";

function getVersionedBaseUrl(version: string): string {
  return `https://ddragon.leagueoflegends.com/cdn/${version}`;
}

/**
 * Get the URL for a champion's square icon.
 *
 * @param championName - The champion name (e.g., "Aatrox", "AurelionSol", "KSante")
 * @returns URL to the champion's square icon image
 *
 * @example
 * getChampionIconUrl("Aatrox", "16.15.1") // => current versioned champion icon
 */
export function getChampionIconUrl(
  championName: string,
  version: string = DDRAGON_FALLBACK_VERSION,
): string {
  // Champion names in Data Dragon use specific formatting:
  // - Single word names: as-is (e.g., "Aatrox")
  // - Multi-word names: camelCase without spaces (e.g., "AurelionSol", "TwistedFate")
  // - Special characters removed (e.g., "Kai'Sa" -> "Kaisa", "K'Sante" -> "KSante")
  // The backend should already provide the correct format from championName field
  return `${getVersionedBaseUrl(version)}/img/champion/${championName}.png`;
}

/**
 * Get the URL for a summoner profile icon.
 *
 * @param profileIconId - The profile icon ID from player data
 * @returns URL to the profile icon image
 */
export function getProfileIconUrl(
  profileIconId: number,
  version: string = DDRAGON_FALLBACK_VERSION,
): string {
  return `${getVersionedBaseUrl(version)}/img/profileicon/${profileIconId}.png`;
}

/**
 * Get fallback URL for a summoner profile icon.
 * Uses default icon 29 when the target icon is unavailable.
 */
export function getProfileIconFallbackUrl(
  profileIconId: number,
  version: string = DDRAGON_FALLBACK_VERSION,
): string {
  void profileIconId;
  return `${getVersionedBaseUrl(version)}/img/profileicon/29.png`;
}

/**
 * Reverse mapping from Data Dragon format to display name.
 * Maps internal names (e.g., "MissFortune") to proper display names (e.g., "Miss Fortune").
 */
export const CHAMPION_DISPLAY_NAME_MAP: Record<string, string> = {
  // Champions with apostrophes
  Kaisa: "Kai'Sa",
  Khazix: "Kha'Zix",
  Chogath: "Cho'Gath",
  Velkoz: "Vel'Koz",
  KogMaw: "Kog'Maw",
  RekSai: "Rek'Sai",
  Belveth: "Bel'Veth",
  KSante: "K'Sante",
  // Champions with spaces
  AurelionSol: "Aurelion Sol",
  DrMundo: "Dr. Mundo",
  JarvanIV: "Jarvan IV",
  LeeSin: "Lee Sin",
  MasterYi: "Master Yi",
  MissFortune: "Miss Fortune",
  Nunu: "Nunu & Willump",
  Renata: "Renata Glasc",
  TahmKench: "Tahm Kench",
  TwistedFate: "Twisted Fate",
  XinZhao: "Xin Zhao",
};

/**
 * Get the proper display name for a champion.
 * Converts Data Dragon format (e.g., "MissFortune") to display name (e.g., "Miss Fortune").
 *
 * @param championName - The champion name from the API (Data Dragon format)
 * @returns The proper display name with spaces and apostrophes
 */
export function getChampionDisplayName(championName: string): string {
  return CHAMPION_DISPLAY_NAME_MAP[championName] || championName;
}

/**
 * Summoner spell ID to name mapping for Data Dragon URLs.
 * These IDs come from the Riot API and need to be mapped to internal names.
 */
export const SUMMONER_SPELL_MAP: Record<number, string> = {
  1: "SummonerBoost", // Cleanse
  3: "SummonerExhaust", // Exhaust
  4: "SummonerFlash", // Flash
  6: "SummonerHaste", // Ghost
  7: "SummonerHeal", // Heal
  11: "SummonerSmite", // Smite
  12: "SummonerTeleport", // Teleport
  13: "SummonerMana", // Clarity
  14: "SummonerDot", // Ignite
  21: "SummonerBarrier", // Barrier
  30: "SummonerPoroRecall", // To the King! (Poro King)
  31: "SummonerPoroThrow", // Poro Toss (Poro King/ARAM)
  32: "SummonerSnowball", // Mark (ARAM)
  39: "SummonerSnowURFSnowball_Mark", // Mark (URF)
  54: "Summoner_UltBookPlaceholder", // Placeholder
  55: "Summoner_UltBookSmitePlaceholder", // Placeholder (Ultimate Spellbook)
};

/**
 * Get the URL for a summoner spell icon by ID.
 *
 * @param spellId - The summoner spell ID from the API
 * @returns URL to the summoner spell icon, or null if not found
 */
export function getSummonerSpellIconUrlById(
  spellId: number,
  version: string = DDRAGON_FALLBACK_VERSION,
): string | null {
  const spellName = SUMMONER_SPELL_MAP[spellId];
  if (!spellName) {
    return null;
  }
  return `${getVersionedBaseUrl(version)}/img/spell/${spellName}.png`;
}

// Keystone rune icon paths from Data Dragon runesReforged data.
const KEYSTONE_ICON_MAP: Record<number, string> = {
  // Domination
  8112: "perk-images/Styles/Domination/Electrocute/Electrocute.png",
  8128: "perk-images/Styles/Domination/DarkHarvest/DarkHarvest.png",
  9923: "perk-images/Styles/Domination/HailOfBlades/HailOfBlades.png",
  // Inspiration
  8351: "perk-images/Styles/Inspiration/GlacialAugment/GlacialAugment.png",
  8360: "perk-images/Styles/Inspiration/UnsealedSpellbook/UnsealedSpellbook.png",
  8369: "perk-images/Styles/Inspiration/FirstStrike/FirstStrike.png",
  // Precision
  8005: "perk-images/Styles/Precision/PressTheAttack/PressTheAttack.png",
  8008: "perk-images/Styles/Precision/LethalTempo/LethalTempoTemp.png",
  8021: "perk-images/Styles/Precision/FleetFootwork/FleetFootwork.png",
  8010: "perk-images/Styles/Precision/Conqueror/Conqueror.png",
  // Resolve
  8437: "perk-images/Styles/Resolve/GraspOfTheUndying/GraspOfTheUndying.png",
  8439: "perk-images/Styles/Resolve/VeteranAftershock/VeteranAftershock.png",
  8465: "perk-images/Styles/Resolve/Guardian/Guardian.png",
  // Sorcery
  8214: "perk-images/Styles/Sorcery/SummonAery/SummonAery.png",
  8229: "perk-images/Styles/Sorcery/ArcaneComet/ArcaneComet.png",
  8230: "perk-images/Styles/Sorcery/PhaseRush/PhaseRush.png",
};

/**
 * Get the URL for a keystone rune icon by keystone ID.
 */
export function getKeystoneIconUrlById(keystoneId: number): string | null {
  const iconPath = KEYSTONE_ICON_MAP[keystoneId];
  if (!iconPath) {
    return null;
  }
  return `${DDRAGON_IMAGE_BASE_URL}/${iconPath}`;
}

export const RUNE_STYLE_MAP: Record<
  number,
  { name: string; iconPath: string }
> = {
  8000: { name: "Precision", iconPath: "perk-images/Styles/7201_Precision.png" },
  8100: {
    name: "Domination",
    iconPath: "perk-images/Styles/7200_Domination.png",
  },
  8200: { name: "Sorcery", iconPath: "perk-images/Styles/7202_Sorcery.png" },
  8300: { name: "Inspiration", iconPath: "perk-images/Styles/7203_Whimsy.png" },
  8400: { name: "Resolve", iconPath: "perk-images/Styles/7204_Resolve.png" },
};

/**
 * Get the name of a rune style.
 *
 * @param styleId - The rune style ID
 * @returns The style name (e.g., "Precision", "Domination"), or null if not found
 */
export function getRuneStyleName(styleId: number): string | null {
  return RUNE_STYLE_MAP[styleId]?.name ?? null;
}

/**
 * Get the URL for a rune style icon by style ID.
 *
 * Uses official Data Dragon rune style icon paths from runesReforged data.
 */
export function getRuneStyleIconUrl(styleId: number): string | null {
  const iconPath = RUNE_STYLE_MAP[styleId]?.iconPath;
  if (!iconPath) {
    return null;
  }
  return `${DDRAGON_IMAGE_BASE_URL}/${iconPath}`;
}
