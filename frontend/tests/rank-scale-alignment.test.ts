import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { rankValueToDisplay } from "@/features/players";

const here = dirname(fileURLToPath(import.meta.url));
const RANK_TEST = join(here, "../../backend/tests/test_matchmaking_ranks.py");
const APEX_TIERS = new Set(["MASTER", "GRANDMASTER", "CHALLENGER"]);

interface ScaleRow {
  tier: string;
  lp: number;
  value: number;
  display: string;
}

/**
 * The scale is the backend's (`ranks.py`); parse its fixtures rather than copy
 * them, so the client's inverse is checked against the table that defines it.
 */
function backendScaleFixtures(): ScaleRow[] {
  const source = readFileSync(RANK_TEST, "utf8");

  const block = /SCALE_FIXTURES\s*=\s*\[([\s\S]*?)\n\]/.exec(source);
  if (!block?.[1]) throw new Error("SCALE_FIXTURES not found in the backend");

  return [
    ...block[1].matchAll(
      /\(\s*"([A-Z]+)"\s*,\s*(?:"[IVX]+"|None)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*"([^"]+)"\s*\)/g,
    ),
  ].map(([, tier, lp, value, display]) => ({
    tier: tier ?? "",
    lp: Number(lp),
    value: Number(value),
    display: display ?? "",
  }));
}

const ROWS = backendScaleFixtures();
// A row naming a division carries the exact string the client renders; the
// apex rows are worded differently on the two sides on purpose.
const DIVISION_ROWS = ROWS.filter((row) => row.display.includes(" · "));
const APEX_ROWS = ROWS.filter((row) => APEX_TIERS.has(row.tier));

describe("the LP scale against the backend fixtures", () => {
  it("reads a plausible table out of the backend rank test", () => {
    // Signal first: a parse that found nothing, or only one kind of row,
    // would leave every case below vacuous.
    expect(ROWS.length).toBeGreaterThanOrEqual(8);
    expect(DIVISION_ROWS.length).toBeGreaterThanOrEqual(5);
    expect(APEX_ROWS.length).toBeGreaterThanOrEqual(3);
  });

  it.each(DIVISION_ROWS)(
    "renders $value the way the backend spells it, $display",
    ({ tier, value, display }) => {
      expect(rankValueToDisplay(value)).toEqual({ tier, label: display });
    },
  );

  it.each(APEX_ROWS)(
    "flattens $tier at $value into the client's one Master+ bucket",
    ({ lp, value }) => {
      // Above the shared floor the client keeps a single MASTER bucket and
      // counts LP from it, so the backend's own LP must come back out.
      expect(rankValueToDisplay(value)).toEqual({
        tier: "MASTER",
        label: `Master+ ${lp} LP`,
      });
    },
  );
});
