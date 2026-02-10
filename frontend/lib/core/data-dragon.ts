/**
 * Data Dragon CDN utilities for League of Legends assets.
 *
 * Data Dragon is Riot's official CDN for game assets like champion icons,
 * item images, summoner spell icons, etc.
 */

// Current Data Dragon version - should be updated when new patches release
// TODO: Consider fetching this dynamically from Riot API
const DDRAGON_VERSION = "15.2.1";

const DDRAGON_BASE_URL = `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}`;

/**
 * Get the URL for a champion's square icon.
 *
 * @param championName - The champion name (e.g., "Aatrox", "AurelionSol", "KSante")
 * @returns URL to the champion's square icon image
 *
 * @example
 * getChampionIconUrl("Aatrox") // => "https://ddragon.leagueoflegends.com/cdn/15.2.1/img/champion/Aatrox.png"
 */
export function getChampionIconUrl(championName: string): string {
  // Champion names in Data Dragon use specific formatting:
  // - Single word names: as-is (e.g., "Aatrox")
  // - Multi-word names: camelCase without spaces (e.g., "AurelionSol", "TwistedFate")
  // - Special characters removed (e.g., "Kai'Sa" -> "Kaisa", "K'Sante" -> "KSante")
  // The backend should already provide the correct format from championName field
  return `${DDRAGON_BASE_URL}/img/champion/${championName}.png`;
}

/**
 * Get the URL for a champion's loading screen splash art.
 *
 * @param championName - The champion name
 * @param skinNum - The skin number (0 = base skin)
 * @returns URL to the champion's loading screen art
 */
export function getChampionLoadingUrl(
  championName: string,
  skinNum: number = 0,
): string {
  return `${DDRAGON_BASE_URL}/img/champion/loading/${championName}_${skinNum}.jpg`;
}

/**
 * Get the URL for a summoner profile icon.
 *
 * @param profileIconId - The profile icon ID from player data
 * @returns URL to the profile icon image
 */
export function getProfileIconUrl(profileIconId: number): string {
  return `${DDRAGON_BASE_URL}/img/profileicon/${profileIconId}.png`;
}

/**
 * Get fallback URL for a summoner profile icon.
 * Uses default icon 29 when the target icon is unavailable.
 */
export function getProfileIconFallbackUrl(profileIconId: number): string {
  void profileIconId;
  return `${DDRAGON_BASE_URL}/img/profileicon/29.png`;
}

/**
 * Get the URL for an item icon.
 *
 * @param itemId - The item ID
 * @returns URL to the item icon image
 */
export function getItemIconUrl(itemId: number): string {
  return `${DDRAGON_BASE_URL}/img/item/${itemId}.png`;
}

/**
 * Get the URL for a summoner spell icon.
 *
 * @param spellName - The spell name (e.g., "SummonerFlash", "SummonerTeleport")
 * @returns URL to the summoner spell icon
 */
export function getSummonerSpellIconUrl(spellName: string): string {
  return `${DDRAGON_BASE_URL}/img/spell/${spellName}.png`;
}

/**
 * Get the current Data Dragon version being used.
 */
export function getDDragonVersion(): string {
  return DDRAGON_VERSION;
}

/**
 * Champion name normalization map for special cases.
 * Data Dragon uses specific internal names that differ from display names.
 */
export const CHAMPION_NAME_MAP: Record<string, string> = {
  // Champions with apostrophes
  "Kai'Sa": "Kaisa",
  "Kha'Zix": "Khazix",
  "Cho'Gath": "Chogath",
  "Vel'Koz": "Velkoz",
  "Kog'Maw": "KogMaw",
  "Rek'Sai": "RekSai",
  "Bel'Veth": "Belveth",
  "K'Sante": "KSante",
  // Champions with spaces (though backend should handle this)
  "Aurelion Sol": "AurelionSol",
  "Dr. Mundo": "DrMundo",
  "Jarvan IV": "JarvanIV",
  "Lee Sin": "LeeSin",
  "Master Yi": "MasterYi",
  "Miss Fortune": "MissFortune",
  "Nunu & Willump": "Nunu",
  "Renata Glasc": "Renata",
  "Tahm Kench": "TahmKench",
  "Twisted Fate": "TwistedFate",
  "Xin Zhao": "XinZhao",
};

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
 * Normalize a champion display name to its Data Dragon format.
 *
 * @param displayName - The champion display name
 * @returns The normalized name for Data Dragon URLs
 */
export function normalizeChampionName(displayName: string): string {
  // Check if there's a specific mapping
  if (CHAMPION_NAME_MAP[displayName]) {
    return CHAMPION_NAME_MAP[displayName];
  }

  // Otherwise, remove spaces and special characters
  return displayName.replace(/['\s.]/g, "");
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
export function getSummonerSpellIconUrlById(spellId: number): string | null {
  const spellName = SUMMONER_SPELL_MAP[spellId];
  if (!spellName) {
    return null;
  }
  return `${DDRAGON_BASE_URL}/img/spell/${spellName}.png`;
}

/**
 * Community Dragon base URL for game data assets
 */
export const RUNE_STYLE_MAP: Record<number, { name: string }> = {
  8000: { name: "Precision" },
  8100: { name: "Domination" },
  8200: { name: "Sorcery" },
  8300: { name: "Inspiration" },
  8400: { name: "Resolve" },
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
