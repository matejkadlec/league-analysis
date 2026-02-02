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
