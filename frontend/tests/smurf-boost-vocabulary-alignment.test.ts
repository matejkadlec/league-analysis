import { readFileSync } from "node:fs";
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
 * The note and family identifiers the engine emits are copied by hand into
 * the vocabulary module's plain-language readings. The fallback that renders
 * an unknown identifier as itself is deliberate (a result computed under a
 * later model version must stay readable), which is exactly why nothing else
 * would ever notice the copy drifting: a renamed or added backend identifier
 * renders as raw snake_case on a page making smurfing observations, with a
 * green suite. The direction that matters is one-way: every identifier the
 * backend emits must read as English here. A label for an identifier the
 * backend no longer emits is allowed; it costs one line.
 *
 * Both constant shapes matter: the family ids (`FAMILY_A = "..."`) do not
 * spell the NOTE_ prefix, so a NOTE_-only sweep would silently drop them and
 * pass vacuously.
 */
function backendIdentifiers(prefix: "NOTE_" | "FAMILY_"): string[] {
  const ids: string[] = [];
  for (const file of ["engine.py", "composite.py", "signals.py"]) {
    const source = readFileSync(join(ENGINE_DIR, file), "utf8");
    for (const [, value] of source.matchAll(
      new RegExp(`^${prefix}[A-Z0-9_]+ = "([a-z0-9_]+)"$`, "gm"),
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
