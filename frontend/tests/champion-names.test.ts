import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  getChampionDisplayName,
  getChampionIconUrl,
  toDataDragonChampionId,
} from "@/lib/core/riot/data-dragon";

// Data Dragon 16.22.1 `champion.json`, reduced to each champion's id, key and
// name: `jq '{type, format, version, data: (.data | map_values({id, key, name}))}'`.
import championJson from "./fixtures/champion-16.22.1.json";

const champions = Object.values(championJson.data);
const championIds = new Set(champions.map((champion) => champion.id));

const here = dirname(fileURLToPath(import.meta.url));
const BACKEND_CONTRACTS = join(
  here,
  "../../backend/tests/fixtures/riot_contracts_2026_08_08.json",
);

/** Every `championName` MATCH-V5 sent in the sanitized backend captures. */
function capturedChampionNames(): string[] {
  const source = readFileSync(BACKEND_CONTRACTS, "utf8");
  return [...source.matchAll(/"championName":\s*"([^"]+)"/g)].flatMap(
    ([, name]) => (name === undefined ? [] : [name]),
  );
}

// The stored MATCH-V5 values whose spelling is not their Data Dragon id or
// public name, as found in a stored database (LGA-117).
const OBSERVED_MATCH_V5_NAMES = ["FiddleSticks", "MonkeyKing", "Leblanc"];

function iconId(url: string): string | undefined {
  return /\/img\/champion\/([^/]+)\.png$/.exec(url)?.[1];
}

describe("champion names and icons against Data Dragon", () => {
  it("reads a plausible champion list", () => {
    expect(champions.length).toBeGreaterThan(150);
  });

  it("shows every champion under the name Data Dragon gives it", () => {
    // The ids that differ from their name (Kaisa, MonkeyKing, Leblanc, ...)
    // are the ones a missing mapping would show raw.
    const misnamed = champions
      .filter((champion) => getChampionDisplayName(champion.id) !== champion.name)
      .map((champion) => `${champion.id} -> ${getChampionDisplayName(champion.id)}`);
    expect(misnamed).toEqual([]);
  });

  it("builds every icon URL from a Data Dragon id", () => {
    const names = [
      ...OBSERVED_MATCH_V5_NAMES,
      ...capturedChampionNames(),
      ...championIds,
    ];
    expect(capturedChampionNames().length).toBeGreaterThan(0);
    const unresolved = names.filter(
      (name) => !championIds.has(iconId(getChampionIconUrl(name, "16.22.1")) ?? ""),
    );
    expect(unresolved).toEqual([]);
  });

  it("normalises the one MATCH-V5 spelling Data Dragon refuses", () => {
    // Riot sends `FiddleSticks`; Data Dragon answers 403 for that file name.
    expect(toDataDragonChampionId("FiddleSticks")).toBe("Fiddlesticks");
    expect(getChampionIconUrl("FiddleSticks", "16.22.1")).toMatch(
      /\/cdn\/16\.22\.1\/img\/champion\/Fiddlesticks\.png$/,
    );
    expect(getChampionDisplayName("FiddleSticks")).toBe("Fiddlesticks");
  });

  it("names Wukong and LeBlanc by their public names", () => {
    expect(getChampionDisplayName("MonkeyKing")).toBe("Wukong");
    expect(getChampionDisplayName("Leblanc")).toBe("LeBlanc");
  });
});
