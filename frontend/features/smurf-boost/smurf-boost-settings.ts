/**
 * The viewer-configurable thresholds of the smurf and boost detection card.
 *
 * The backend owns the ranges (`SmurfBoostDetectionMutableSettingsWriteV1` in
 * `backend/app/features/settings/schemas.py`) and rejects anything outside
 * them, but it exposes no endpoint that describes them, so the form needs its
 * own copy to label a field and to stop an impossible value before it becomes
 * a server error. `tests/smurf-boost-settings.test.ts` reads that file and
 * fails if any bound here drifts from it.
 */

export const SMURF_BOOST_CARD_ID = "profile.smurf-boost-detection";

export interface ThresholdField {
  /** Field name in the card settings write contract. */
  name: string;
  label: string;
  explanation: string;
  min: number;
  max: number;
  /** Whole numbers only, matching the backend's integer fields. */
  integer: boolean;
}

export const THRESHOLD_FIELDS: ThresholdField[] = [
  {
    name: "recentWindowSize",
    label: "Recent games compared",
    explanation:
      "How many of the newest eligible games count as recent. The earlier games sit behind these.",
    min: 10,
    max: 50,
    integer: true,
  },
  {
    name: "baselineWindowSize",
    label: "Earlier games compared against",
    explanation:
      "How many games before the recent ones form the player's own baseline.",
    min: 15,
    max: 200,
    integer: true,
  },
  {
    name: "a1StepChangeThreshold",
    label: "A1 performance step",
    explanation:
      "How far recent per-game performance must sit above the baseline, in standardized units.",
    min: 0.6,
    max: 2.0,
    integer: false,
  },
  {
    name: "a2WinRateSurgeThreshold",
    label: "A2 win-rate rise",
    explanation:
      "How far the cautious estimate of the recent win rate must sit above the baseline win rate, as a fraction. The recent rate is discounted for the size of the window first, so a short lucky run counts for less than its face value.",
    min: 0.1,
    max: 0.35,
    integer: false,
  },
  {
    name: "a3NovelChampionThreshold",
    label: "A3 rarely played performance",
    explanation:
      "How far above the baseline the games on rarely played champions must sit.",
    min: 0.6,
    max: 2.0,
    integer: false,
  },
  {
    name: "a3MinimumNovelGames",
    label: "A3 rarely played games needed",
    explanation:
      "How many recent games on rarely played champions are needed before A3 is measured. Never more than the recent window.",
    min: 5,
    max: 15,
    integer: true,
  },
  {
    name: "a4SummonerLevelGate",
    label: "A4 account level gate",
    explanation:
      "At or below this account level, strong recent play counts towards A4.",
    min: 30,
    max: 150,
    integer: true,
  },
  {
    name: "a4PerformanceThreshold",
    label: "A4 performance on a new account",
    explanation:
      "How far above the baseline recent performance must sit for A4, in standardized units.",
    min: 0.6,
    max: 2.0,
    integer: false,
  },
  {
    name: "b1WinRateDeltaThreshold",
    label: "B1 win-rate rise without performance",
    explanation:
      "How much the win rate must rise while per-game performance stays flat.",
    min: 0.15,
    max: 0.45,
    integer: false,
  },
  {
    name: "b1CompositeFlatCeiling",
    label: "B1 performance treated as flat",
    explanation:
      "How little per-game performance may move and still count as unchanged.",
    min: 0.0,
    max: 0.4,
    integer: false,
  },
  {
    name: "b2ConsistencyShiftThreshold",
    label: "B2 consistency change",
    explanation:
      "How far the spread of recent results must move, in doublings of spread.",
    min: 0.6,
    max: 1.5,
    integer: false,
  },
  {
    name: "b3BimodalityThreshold",
    label: "B3 split between strong and weak games",
    explanation:
      "How far the recent games must separate into a strong group and a weak group.",
    min: 0.555,
    max: 0.8,
    integer: false,
  },
  {
    name: "b3TailFraction",
    label: "B3 share counted as a tail",
    explanation:
      "What share of the recent games counts as the strong or weak end.",
    min: 0.15,
    max: 0.4,
    integer: false,
  },
  {
    name: "b4HighRateFloor",
    label: "B4 win rate counted as high",
    explanation: "The win rate a run must reach before a later drop counts.",
    min: 0.5,
    max: 0.8,
    integer: false,
  },
  {
    name: "b4DropThreshold",
    label: "B4 drop after a high win rate",
    explanation: "How far the win rate must fall from that high run.",
    min: 0.1,
    max: 0.45,
    integer: false,
  },
];

/**
 * The one cross-field rule the backend enforces, restated here so the form can
 * say what is wrong before a request is sent. The server remains the authority
 * and rejects the write regardless.
 */
export function crossFieldError(
  values: Record<string, number>,
): string | null {
  const novel = values.a3MinimumNovelGames;
  const recent = values.recentWindowSize;
  if (
    Number.isFinite(novel) &&
    Number.isFinite(recent) &&
    novel > recent
  ) {
    return "A3 rarely played games needed cannot exceed the recent games compared.";
  }
  return null;
}

export function fieldError(
  field: ThresholdField,
  value: number,
): string | null {
  if (!Number.isFinite(value)) {
    return `${field.label} needs a number.`;
  }
  if (field.integer && !Number.isInteger(value)) {
    return `${field.label} must be a whole number.`;
  }
  if (value < field.min || value > field.max) {
    return `${field.label} must be between ${field.min} and ${field.max}.`;
  }
  return null;
}

/**
 * Not every card setting is a number — Top Champions carries a role list — so
 * the shared response shape is untyped and this narrows it for one card.
 */
export function numericSettings(
  settings: Record<string, unknown>,
): Record<string, number> {
  const numeric: Record<string, number> = {};
  for (const [name, value] of Object.entries(settings)) {
    if (typeof value === "number") {
      numeric[name] = value;
    }
  }
  return numeric;
}

/**
 * The effective settings carry the card's fixed values too. The write contract
 * forbids unknown fields, so only the configurable ones are sent back.
 */
export function writableSettings(
  settings: Record<string, number>,
): Record<string, number> {
  const payload: Record<string, number> = {};
  for (const field of THRESHOLD_FIELDS) {
    const value = settings[field.name];
    if (value !== undefined) {
      payload[field.name] = value;
    }
  }
  return payload;
}

/**
 * The baseline floor the model treats as a correctness constraint.
 *
 * It is not configurable and the API never sends it, so this is a second copy
 * of a backend constant. `tests/smurf-boost-settings.test.ts` reads the
 * backend's own `config.py` and fails on any drift, because the number is what
 * the "Not enough data" state counts with and nothing else would catch it.
 */
export const MINIMUM_BASELINE_GAMES = 15;

/** Preset names as shown to a reader, rather than as stored identifiers. */
export const PRESET_LABELS: Record<string, string> = {
  conservative: "Conservative",
  balanced: "Balanced",
  sensitive: "Sensitive",
};

export const PRESET_DESCRIPTIONS: Record<string, string> = {
  conservative:
    "The shipped default. The hardest to trigger, and the least likely to call ordinary improvement unusual.",
  balanced: "A middle setting: a shorter baseline and lower thresholds.",
  sensitive:
    "The easiest to trigger, and the most likely to report indicators on ordinary variation. Nothing here measures how often that happens: there are no labelled cases to measure against.",
};

export function presetLabel(name: string): string {
  return PRESET_LABELS[name] ?? name;
}

export function presetDescription(name: string): string {
  return PRESET_DESCRIPTIONS[name] ?? "";
}

/** True when every configurable value equals the preset's. */
export function matchesPreset(
  settings: Record<string, number>,
  preset: Record<string, number>,
): boolean {
  return THRESHOLD_FIELDS.every(
    (field) => settings[field.name] === preset[field.name],
  );
}
