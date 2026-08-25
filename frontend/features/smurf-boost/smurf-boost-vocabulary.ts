import type {
  SmurfBoostBand,
  SmurfBoostConfidenceBand,
} from "@/lib/core/schemas";

/**
 * The wording the model fixes -- band vocabulary, family titles, confidence
 * labels, note readings, disclaimer -- in its only frontend copy, so nothing
 * drifts from the specification or reaches for a forbidden word. Ordinary
 * page copy is written where it is used.
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
 * An unknown family is rendered as its own identifier rather than dropped, for
 * the same reason an unknown note is: a result computed under a later model
 * version must still be readable instead of failing the whole page.
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
 * What each band means, in the specification's own words. A band name alone
 * is a finding word: "Weak indicators" without "likely ordinary variance"
 * beside it reads as a small accusation rather than the caution it is.
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
  return BAND_MEANINGS[band] ?? "";
}

export const CONFIDENCE_LABELS: Record<SmurfBoostConfidenceBand, string> = {
  low: "Low confidence",
  medium: "Medium confidence",
  high: "High confidence",
};

/**
 * Plain-language readings of the identifiers the backend emits.
 *
 * An unrecognised identifier is rendered as itself rather than hidden, because
 * the specification requires every data-quality limit to stay visible.
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
