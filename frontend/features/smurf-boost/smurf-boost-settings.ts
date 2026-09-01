import type { CardId } from "@/lib/core/schemas";

/** Typed against the API's own card-id enum, so a rename fails here. */
export const SMURF_BOOST_CARD_ID: CardId = "profile.smurf-boost-detection";

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

/**
 * The backend owns these ranges but exposes no endpoint describing them, so
 * the form carries its own copy; `tests/smurf-boost-settings.test.ts` pins it.
 */
export const THRESHOLD_FIELDS = [
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
] as const satisfies readonly ThresholdField[];

/** The names the write contract accepts, derived so a new field cannot be missed. */
export type ThresholdName = (typeof THRESHOLD_FIELDS)[number]["name"];

/**
 * Thresholds on their way to the server. Partial because a value the response
 * never carried is left out rather than posted as a guess.
 */
export type ThresholdSettings = Partial<Record<ThresholdName, number>>;

/**
 * The loop is what makes the result total, so this is the only place that has
 * to assert it; every caller gets a map with an entry per name.
 */
export function byThreshold<T>(
  derive: (field: (typeof THRESHOLD_FIELDS)[number]) => T,
): Record<ThresholdName, T> {
  const values = {} as Record<ThresholdName, T>;
  for (const field of THRESHOLD_FIELDS) {
    values[field.name] = derive(field);
  }
  return values;
}

/**
 * The backend's own cross-field rule, restated so the form can say what is
 * wrong first; the server stays the authority and rejects the write anyway.
 */
export function crossFieldError(values: ThresholdSettings): string | null {
  const novel = values.a3MinimumNovelGames;
  const recent = values.recentWindowSize;
  if (
    novel !== undefined &&
    recent !== undefined &&
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
  return Object.fromEntries(
    Object.entries(settings).filter(
      (entry): entry is [string, number] => typeof entry[1] === "number",
    ),
  );
}

/**
 * The effective settings carry the card's fixed values too. The write contract
 * forbids unknown fields, so only the configurable ones are sent back.
 */
export function writableSettings(
  settings: Record<string, number>,
): ThresholdSettings {
  // A loop, not `map` into `Object.fromEntries`: that loses the tuple, and the
  // widened value type it leaves would post a string.
  const payload: ThresholdSettings = {};
  for (const field of THRESHOLD_FIELDS) {
    const value = settings[field.name];
    if (value !== undefined) {
      payload[field.name] = value;
    }
  }
  return payload;
}

/**
 * A second copy of a backend constant the API never sends;
 * `tests/smurf-boost-settings.test.ts` reads `config.py` for drift.
 */
export const MINIMUM_BASELINE_GAMES = 15;

/**
 * The recent window is taken first, so quoting only the sample floors
 * understates it; `fallbackRecentWindow` covers a run without a window.
 */
export function gameShortfall(
  eligibleGames: number,
  thresholds: Record<string, number>,
  fallbackRecentWindow: number,
): { missing: number; sentence: string } {
  const stored = thresholds.recent_window_size;
  const recentWindow =
    stored !== undefined && Number.isFinite(stored)
      ? stored
      : fallbackRecentWindow;
  const required = recentWindow + MINIMUM_BASELINE_GAMES;
  const missing = Math.max(0, required - eligibleGames);
  return {
    missing,
    sentence:
      `This player has ${eligibleGames} eligible ranked solo/duo ` +
      `${eligibleGames === 1 ? "game" : "games"} stored. The comparison ` +
      `reads the most recent ${recentWindow} and needs at least ` +
      `${MINIMUM_BASELINE_GAMES} earlier games behind them, so at least ` +
      `${required} in total` +
      (missing > 0 ? `, which is ${missing} more than are stored` : "") +
      ".",
  };
}

/** Preset names as shown to a reader, rather than as stored identifiers. */
const PRESET_LABELS: Record<string, string> = {
  conservative: "Conservative",
  balanced: "Balanced",
  sensitive: "Sensitive",
};

const PRESET_DESCRIPTIONS: Record<string, string> = {
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
