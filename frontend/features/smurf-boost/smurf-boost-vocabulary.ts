import type {
  SmurfBoostBand,
  SmurfBoostConfidenceBand,
} from "@/lib/core/schemas";

/**
 * The only frontend copy of the model's fixed wording and band colours, so
 * nothing drifts from the specification.
 */

export const FAMILY_TITLES: Record<string, string> = {
  rapid_improvement: "Rapid Improvement Pattern",
  playing_pattern_change: "Playing Pattern Change",
};

export const FAMILY_DESCRIPTIONS: Record<string, string> = {
  rapid_improvement:
    "Whether recent games look stronger than this player's own earlier games.",
  playing_pattern_change:
    "Whether recent games look different in shape from this player's own earlier games.",
};

/**
 * An unknown family renders as its own identifier so a result from a later
 * model version stays readable instead of failing the page.
 */
export function familyTitle(family: string): string {
  return FAMILY_TITLES[family] ?? family;
}

export function familyDescription(family: string): string {
  return FAMILY_DESCRIPTIONS[family] ?? "";
}

export const BAND_LABELS: Record<SmurfBoostBand, string> = {
  not_enough_data: "Not enough data",
  no_unusual_pattern: "No unusual pattern",
  weak_indicators: "Weak indicators",
  notable_indicators: "Notable indicators",
  strong_indicators: "Strong indicators",
};

/**
 * A band name alone reads as an accusation; the specification's own meaning
 * has to travel beside it.
 */
export const BAND_MEANINGS: Record<SmurfBoostBand, string> = {
  not_enough_data: "Fewer eligible ranked games than the model requires",
  no_unusual_pattern: "Nothing in the stored history stands out",
  weak_indicators: "One area moved; likely ordinary variance",
  notable_indicators: "Two different areas moved together",
  strong_indicators:
    "Three different areas moved together and by a wide margin",
};

export function bandMeaning(band: SmurfBoostBand): string {
  return BAND_MEANINGS[band];
}

/**
 * One ladder shared by both cards so they cannot drift; classes stay whole
 * literals because Tailwind scans strings.
 */
export const BAND_STYLES: Record<
  SmurfBoostBand,
  { text: string; accent: string; dot: string }
> = {
  strong_indicators: {
    text: "text-rose-500",
    accent: "border-l-rose-500",
    dot: "bg-rose-500",
  },
  notable_indicators: {
    text: "text-amber-500",
    accent: "border-l-amber-500",
    dot: "bg-amber-500",
  },
  weak_indicators: {
    text: "text-yellow-500",
    accent: "border-l-yellow-500",
    dot: "bg-yellow-500",
  },
  no_unusual_pattern: {
    text: "text-emerald-500",
    accent: "border-l-emerald-500",
    dot: "bg-emerald-500",
  },
  not_enough_data: {
    text: "text-muted-foreground",
    accent: "border-l-muted-foreground",
    dot: "bg-muted-foreground",
  },
};

export const CONFIDENCE_LABELS: Record<SmurfBoostConfidenceBand, string> = {
  low: "Low confidence",
  medium: "Medium confidence",
  high: "High confidence",
};

/**
 * An unrecognised identifier renders as itself rather than hidden: the
 * specification requires every data-quality limit to stay visible.
 */
export const NOTE_LABELS: Record<string, string> = {
  patch_disjoint_windows:
    "The recent and earlier games were played on different game patches, so some of the difference may be the patch rather than the player.",
  legacy_game_start_timestamps:
    "Some games were stored with loading-screen times rather than true start times.",
  rank_corroboration_unavailable:
    "There is not enough stored rank history to corroborate the comparison.",
  role_baseline_pooled:
    "Some roles had too few earlier games to compare within the role, so those games were compared against the player's overall earlier games.",
  time_played_missing:
    "Some games were missing a played duration, so game length was used instead.",
  degenerate_baseline:
    "Every earlier game scored identically, so there is no spread to compare against.",
  insufficient_novel_sample:
    "Too few recent games were on champions with little stored history.",
  insufficient_shape_sample:
    "Too few recent games, or no spread between them, to measure their shape.",
  novel_is_storage_scoped:
    "A champion counts as rarely played only against the games this application has stored, which may not be the player's whole history.",
  summoner_level_unknown: "The account level is not stored for this player.",
  weak_account_age_proxy:
    "Account level is only a weak stand-in for how new an account is.",
  undefined_statistic:
    "The measurement is undefined for this set of games, so it was not used.",
};

export function noteLabel(note: string): string {
  return NOTE_LABELS[note] ?? note;
}

export const DISCLAIMER =
  "This is a statistical comparison of a player's recent ranked games against their own earlier games. It is not evidence of smurfing, boosting, or account sharing, and it cannot distinguish improvement from any other explanation. Do not use it to accuse anyone.";
