import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  crossFieldError,
  fieldError,
  matchesPreset,
  THRESHOLD_FIELDS,
  writableSettings,
} from "../features/smurf-boost/smurf-boost-settings";

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
    const [head, ...tail] = match[1].split("_");
    const name =
      head + tail.map((part) => part[0].toUpperCase() + part.slice(1)).join("");
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

  it("gives every field a label and an explanation", () => {
    for (const field of THRESHOLD_FIELDS) {
      expect(field.label.length).toBeGreaterThan(3);
      expect(field.explanation.length).toBeGreaterThan(20);
    }
  });

  it("rejects a value the server would reject", () => {
    const window = THRESHOLD_FIELDS[0];
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
