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
 * Get the URL every profile icon degrades to when Data Dragon has no art for
 * the one the player actually wears.
 */
export function getProfileIconFallbackUrl(
  version: string = DDRAGON_FALLBACK_VERSION,
): string {
  return `${getVersionedBaseUrl(version)}/img/profileicon/29.png`;
}

/**
 * Reverse mapping from Data Dragon format to display name.
 * Maps internal names (e.g., "MissFortune") to proper display names (e.g., "Miss Fortune").
 */
const CHAMPION_DISPLAY_NAME_MAP: Record<string, string> = {
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
 * Summoner spell ID to Data Dragon asset and display name.
 *
 * The IDs come from the Riot API; `asset` builds the icon URL and `name` is
 * what the spell is called in game, both taken from `summoner.json` (en_US).
 * Kept in the same one-entry-carries-both shape as the rune maps below — the
 * second field is `iconPath` there and `asset` here because one is a path and
 * the other a filename — so a caller never has to reach for a second, drifting
 * table of names.
 */
const SUMMONER_SPELL_MAP: Record<number, { name: string; asset: string }> = {
  1: { name: "Cleanse", asset: "SummonerBoost" },
  3: { name: "Exhaust", asset: "SummonerExhaust" },
  4: { name: "Flash", asset: "SummonerFlash" },
  6: { name: "Ghost", asset: "SummonerHaste" },
  7: { name: "Heal", asset: "SummonerHeal" },
  11: { name: "Smite", asset: "SummonerSmite" },
  12: { name: "Teleport", asset: "SummonerTeleport" },
  13: { name: "Clarity", asset: "SummonerMana" },
  14: { name: "Ignite", asset: "SummonerDot" },
  21: { name: "Barrier", asset: "SummonerBarrier" },
  30: { name: "To the King!", asset: "SummonerPoroRecall" },
  31: { name: "Poro Toss", asset: "SummonerPoroThrow" },
  32: { name: "Mark", asset: "SummonerSnowball" },
  39: { name: "Mark", asset: "SummonerSnowURFSnowball_Mark" },
  54: { name: "Placeholder", asset: "Summoner_UltBookPlaceholder" },
  55: {
    name: "Placeholder and Attack-Smite",
    asset: "Summoner_UltBookSmitePlaceholder",
  },
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
  const asset = SUMMONER_SPELL_MAP[spellId]?.asset;
  if (!asset) {
    return null;
  }
  return `${getVersionedBaseUrl(version)}/img/spell/${asset}.png`;
}

/**
 * Get the in-game name of a summoner spell by ID.
 *
 * @returns The display name (e.g. "Flash"), or null if the ID is unknown
 */
export function getSummonerSpellName(spellId: number): string | null {
  return SUMMONER_SPELL_MAP[spellId]?.name ?? null;
}

/**
 * Keystone rune icons and display names from Data Dragon `runesReforged`
 * (en_US). The two are one entry because a label that disagrees with the icon
 * next to it is worse than no label: 8439's asset is still the old
 * `VeteranAftershock`, while the rune has been called Aftershock in game for
 * years, and 8008's is `LethalTempoTemp`.
 */
const KEYSTONE_MAP: Record<number, { name: string; iconPath: string }> = {
  // Domination
  8112: {
    name: "Electrocute",
    iconPath: "perk-images/Styles/Domination/Electrocute/Electrocute.png",
  },
  8128: {
    name: "Dark Harvest",
    iconPath: "perk-images/Styles/Domination/DarkHarvest/DarkHarvest.png",
  },
  9923: {
    name: "Hail of Blades",
    iconPath: "perk-images/Styles/Domination/HailOfBlades/HailOfBlades.png",
  },
  // Inspiration
  8351: {
    name: "Glacial Augment",
    iconPath:
      "perk-images/Styles/Inspiration/GlacialAugment/GlacialAugment.png",
  },
  8360: {
    name: "Unsealed Spellbook",
    iconPath:
      "perk-images/Styles/Inspiration/UnsealedSpellbook/UnsealedSpellbook.png",
  },
  8369: {
    name: "First Strike",
    iconPath: "perk-images/Styles/Inspiration/FirstStrike/FirstStrike.png",
  },
  // Precision
  8005: {
    name: "Press the Attack",
    iconPath: "perk-images/Styles/Precision/PressTheAttack/PressTheAttack.png",
  },
  8008: {
    name: "Lethal Tempo",
    iconPath: "perk-images/Styles/Precision/LethalTempo/LethalTempoTemp.png",
  },
  8021: {
    name: "Fleet Footwork",
    iconPath: "perk-images/Styles/Precision/FleetFootwork/FleetFootwork.png",
  },
  8010: {
    name: "Conqueror",
    iconPath: "perk-images/Styles/Precision/Conqueror/Conqueror.png",
  },
  // Resolve
  8437: {
    name: "Grasp of the Undying",
    iconPath:
      "perk-images/Styles/Resolve/GraspOfTheUndying/GraspOfTheUndying.png",
  },
  8439: {
    name: "Aftershock",
    iconPath:
      "perk-images/Styles/Resolve/VeteranAftershock/VeteranAftershock.png",
  },
  8465: {
    name: "Guardian",
    iconPath: "perk-images/Styles/Resolve/Guardian/Guardian.png",
  },
  // Sorcery
  8214: {
    name: "Summon Aery",
    iconPath: "perk-images/Styles/Sorcery/SummonAery/SummonAery.png",
  },
  8229: {
    name: "Arcane Comet",
    iconPath: "perk-images/Styles/Sorcery/ArcaneComet/ArcaneComet.png",
  },
  8230: {
    name: "Phase Rush",
    iconPath: "perk-images/Styles/Sorcery/PhaseRush/PhaseRush.png",
  },
};

/**
 * Get the URL for a keystone rune icon by keystone ID.
 */
export function getKeystoneIconUrlById(keystoneId: number): string | null {
  const iconPath = KEYSTONE_MAP[keystoneId]?.iconPath;
  if (!iconPath) {
    return null;
  }
  return `${DDRAGON_IMAGE_BASE_URL}/${iconPath}`;
}

/**
 * Get the in-game name of a keystone rune by ID.
 *
 * @returns The display name (e.g. "Conqueror"), or null if the ID is unknown
 */
export function getKeystoneName(keystoneId: number): string | null {
  return KEYSTONE_MAP[keystoneId]?.name ?? null;
}

const RUNE_STYLE_MAP: Record<
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
