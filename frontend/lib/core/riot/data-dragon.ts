/**
 * Data Dragon CDN utilities: Riot's official CDN for game assets like champion
 * icons, item images and summoner spell icons.
 */

// Used only when Riot's version manifest cannot be reached. The root layout
// normally resolves the latest version and provides it to client code.
export const DDRAGON_FALLBACK_VERSION = "16.15.1";

const DDRAGON_IMAGE_BASE_URL = "https://ddragon.leagueoflegends.com/cdn/img";

function getVersionedBaseUrl(version: string): string {
  return `https://ddragon.leagueoflegends.com/cdn/${version}`;
}

export function getChampionIconUrl(
  championName: string,
  version: string = DDRAGON_FALLBACK_VERSION,
): string {
  // `championName` must already be in Data Dragon's own spelling -- camelCase,
  // no spaces, no punctuation ("AurelionSol", "Kaisa", "KSante") -- which is
  // what the backend's `championName` field carries.
  return `${getVersionedBaseUrl(version)}/img/champion/${championName}.png`;
}

/** Get the URL for a summoner profile icon. */
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

/** Data Dragon spelling to in-game name: "MissFortune" -> "Miss Fortune". */
export function getChampionDisplayName(championName: string): string {
  return CHAMPION_DISPLAY_NAME_MAP[championName] || championName;
}

/**
 * Riot spell ID to `summoner.json` (en_US) asset and in-game name. One entry
 * carries both, like the rune maps below, so no caller has to reach for a
 * second table of names that can drift away from the icons.
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

/** Get the URL for a summoner spell icon by ID, or null when unmapped. */
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
 * Keystone icons and names from `runesReforged` (en_US), one entry each: the
 * asset filename is not the in-game name and cannot be derived from it (8439
 * is still `VeteranAftershock`, 8008 is `LethalTempoTemp`).
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

/** Get the name of a rune style ("Precision"), or null when unmapped. */
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
