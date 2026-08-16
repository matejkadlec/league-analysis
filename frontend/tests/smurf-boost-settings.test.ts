import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CardPreferenceSchema } from "../lib/core/schemas";
import {
  crossFieldError,
  MINIMUM_BASELINE_GAMES,
  fieldError,
  matchesPreset,
  numericSettings,
  THRESHOLD_FIELDS,
  writableSettings,
} from "../features/smurf-boost/smurf-boost-settings";

/** The three-card response exactly as the running API returns it. */
const LIVE_CATALOG = [
  {
    cardId: "profile.top-champions",
    version: 1,
    settings: {
      queueId: 420,
      displayLimit: 5,
      minimumGames: 1,
      minimumWinRate: 0.0,
      minimumKda: 0.0,
      includedRoles: [],
    },
    isDefault: true,
    requiresRecovery: false,
    updatedAt: null,
  },
  {
    cardId: "profile.recent-performance",
    version: 1,
    settings: {
      queueId: 420,
      recentMatchCount: 10,
      winRateTrendDelta: 0.05,
      relativeMetricTrendDelta: 0.05,
    },
    isDefault: true,
    requiresRecovery: false,
    updatedAt: null,
  },
  {
    cardId: "profile.smurf-boost-detection",
    version: 1,
    settings: {
      queueId: 420,
      recentWindowSize: 20,
      baselineWindowSize: 60,
      a1StepChangeThreshold: 1.2,
      a2WinRateSurgeThreshold: 0.2,
      a3NovelChampionThreshold: 1.2,
      a3MinimumNovelGames: 8,
      a4SummonerLevelGate: 45,
      a4PerformanceThreshold: 1.2,
      b1WinRateDeltaThreshold: 0.3,
      b1CompositeFlatCeiling: 0.05,
      b2ConsistencyShiftThreshold: 1.15,
      b3BimodalityThreshold: 0.65,
      b3TailFraction: 0.3,
      b4HighRateFloor: 0.62,
      b4DropThreshold: 0.2,
    },
    isDefault: true,
    requiresRecovery: false,
    updatedAt: null,
  },
];

/**
 * The backend owns every bound and exposes none of them over the API, so the
 * form carries its own copy. This reads the authority and fails on any drift,
 * which is the only thing standing between a silent edit there and a form here
 * that accepts a value the server will reject.
 */
function backendBounds(): Map<string, { min: number; max: number; integer: boolean }> {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(
    join(here, "../../backend/app/features/settings/schemas.py"),
    "utf8",
  );
  const block =
    /class SmurfBoostDetectionMutableSettingsWriteV1\(_CardSettingsWriteBase\):([\s\S]*?)\n    @field_validator/.exec(
      source,
    );
  expect(block).not.toBeNull();

  const bounds = new Map<string, { min: number; max: number; integer: boolean }>();
  const line =
    /^ {4}(\w+): (int|float) = Field\(default=[\d.]+, ge=([\d.]+), le=([\d.]+)\)$/gm;
  for (const match of (block?.[1] ?? "").matchAll(line)) {
    // The API renames every field to camelCase before it reaches a client.
    const [head = "", ...tail] = (match[1] ?? "").split("_");
    const name =
      head +
      tail
        .map((part) => (part[0] ?? "").toUpperCase() + part.slice(1))
        .join("");
    bounds.set(name, {
      min: Number(match[3]),
      max: Number(match[4]),
      integer: match[2] === "int",
    });
  }
  return bounds;
}

describe("smurf and boost threshold catalog", () => {
  it("matches every bound the backend enforces", () => {
    const bounds = backendBounds();
    expect(bounds.size).toBe(15);
    expect(THRESHOLD_FIELDS.length).toBe(bounds.size);

    for (const field of THRESHOLD_FIELDS) {
      const backend = bounds.get(field.name);
      expect(backend, `${field.name} is not a backend field`).toBeTruthy();
      expect(field.min, `${field.name} min`).toBe(backend?.min);
      expect(field.max, `${field.name} max`).toBe(backend?.max);
      expect(field.integer, `${field.name} kind`).toBe(backend?.integer);
    }
  });

  it("carries the backend's baseline floor, which is not on the wire", () => {
    // "Not enough data" is the majority outcome on this database, so its
    // arithmetic is the most-read sentence in the feature. The recent window
    // comes from the run; this number does not, and nothing else would catch a
    // change to it.
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      join(here, "../../backend/app/features/smurf_boost_detection/config.py"),
      "utf8",
    );
    const declared =
      /^MINIMUM_BASELINE_GAMES: Final\[int\] = (\d+)$/m.exec(source);
    expect(declared).not.toBeNull();
    expect(Number(declared?.[1])).toBe(MINIMUM_BASELINE_GAMES);
  });

  it("gives every field a label and an explanation", () => {
    for (const field of THRESHOLD_FIELDS) {
      expect(field.label.length).toBeGreaterThan(3);
      expect(field.explanation.length).toBeGreaterThan(20);
    }
  });

  it("rejects a value the server would reject", () => {
    const window = THRESHOLD_FIELDS[0];
    if (!window) {
      throw new Error("THRESHOLD_FIELDS is empty");
    }
    expect(fieldError(window, 20)).toBeNull();
    expect(fieldError(window, 9)).toBe(
      "Recent games compared must be between 10 and 50.",
    );
    expect(fieldError(window, 51)).toContain("between 10 and 50");
    expect(fieldError(window, 20.5)).toBe(
      "Recent games compared must be a whole number.",
    );
    expect(fieldError(window, Number.NaN)).toBe(
      "Recent games compared needs a number.",
    );
  });

  it("restates the one cross-field rule the server enforces", () => {
    // Verified against the live API: posting these two values returns 422 with
    // "a3MinimumNovelGames must not exceed recentWindowSize".
    expect(
      crossFieldError({ recentWindowSize: 10, a3MinimumNovelGames: 15 }),
    ).toContain("cannot exceed");
    expect(
      crossFieldError({ recentWindowSize: 20, a3MinimumNovelGames: 8 }),
    ).toBeNull();
  });

  it("restates a rule the backend still has", () => {
    // Without this, deleting the server-side rule would leave the guard above
    // green while the form kept explaining a constraint nobody enforces.
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      join(here, "../../backend/app/features/settings/schemas.py"),
      "utf8",
    );
    expect(source).toContain(
      "a3MinimumNovelGames must not exceed recentWindowSize",
    );
    expect(source).toContain("_validate_smurf_boost_cross_fields");
    // Exactly one cross-field rule exists, so the form is not silently missing
    // a second one.
    expect(
      source.split("must not exceed recentWindowSize").length - 1,
    ).toBe(1);
  });

  it("accepts the whole card catalog the API actually returns", () => {
    // A numeric-only settings shape rejected every card, because Top Champions
    // carries a role list. That failure hid the smurf-boost card completely.
    for (const card of LIVE_CATALOG) {
      expect(() => CardPreferenceSchema.parse(card)).not.toThrow();
    }
    const smurfBoost = CardPreferenceSchema.parse(LIVE_CATALOG[2]);
    const numeric = numericSettings(smurfBoost.settings);
    expect(Object.keys(numeric).length).toBe(THRESHOLD_FIELDS.length + 1);
    expect(numeric.recentWindowSize).toBe(20);

    const topChampions = CardPreferenceSchema.parse(LIVE_CATALOG[0]);
    expect(Array.isArray(topChampions.settings.includedRoles)).toBe(true);
  });

  it("sends back only the fields the write contract accepts", () => {
    // The effective settings carry the card's fixed queueId, which the write
    // model forbids; including it makes the whole request a 422.
    const payload = writableSettings({
      queueId: 420,
      recentWindowSize: 20,
      baselineWindowSize: 60,
    });
    expect(payload.queueId).toBeUndefined();
    expect(payload.recentWindowSize).toBe(20);
    expect(Object.keys(payload).length).toBe(2);
  });

  it("recognises a preset only when every value matches", () => {
    const preset = Object.fromEntries(
      THRESHOLD_FIELDS.map((field) => [field.name, field.min]),
    );
    expect(matchesPreset({ ...preset, queueId: 420 }, preset)).toBe(true);
    expect(
      matchesPreset({ ...preset, b4DropThreshold: 0.44 }, preset),
    ).toBe(false);
  });
});
