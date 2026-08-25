import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  FAMILY_DESCRIPTIONS,
  FAMILY_TITLES,
  NOTE_LABELS,
} from "../features/smurf-boost/smurf-boost-vocabulary";

const here = dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = join(here, "../../backend/app/features/smurf_boost_detection");

/**
 * The engine's identifiers are copied by hand into the vocabulary module, and
 * a self-naming fallback means nothing else notices the copy drifting. Both
 * constant shapes matter: family ids do not spell the NOTE_ prefix.
 */
function backendIdentifiers(prefix: "NOTE_" | "FAMILY_"): string[] {
  const ids: string[] = [];
  // Every module in the feature, not a hardcoded list, so a new engine file
  // cannot carry identifiers this sweep never reads. The pattern tolerates a
  // type annotation (`NOTE_X: Final = "..."`) for the same reason.
  for (const file of readdirSync(ENGINE_DIR).filter((f) => f.endsWith(".py"))) {
    const source = readFileSync(join(ENGINE_DIR, file), "utf8");
    for (const [, value] of source.matchAll(
      new RegExp(`^${prefix}[A-Z0-9_]+(?::[^=]*)? = "([a-z0-9_]+)"$`, "gm"),
    )) {
      if (value !== undefined) ids.push(value);
    }
  }
  return ids;
}

describe("smurf-boost vocabulary against the engine", () => {
  const notes = backendIdentifiers("NOTE_");
  const families = backendIdentifiers("FAMILY_");

  it("reads a plausible identifier set out of the backend", () => {
    // Signal first: a parse that silently returned nothing would make every
    // assertion below vacuous.
    expect(notes.length).toBeGreaterThanOrEqual(10);
    expect(families.length).toBeGreaterThanOrEqual(2);
  });

  it("reads every note the engine can emit as English", () => {
    const unread = notes.filter((note) => NOTE_LABELS[note] === undefined);
    expect(unread).toEqual([]);
  });

  it("titles and describes every family the engine can emit", () => {
    const untitled = families.filter(
      (family) =>
        FAMILY_TITLES[family] === undefined ||
        FAMILY_DESCRIPTIONS[family] === undefined,
    );
    expect(untitled).toEqual([]);
  });
});
