import type { Division, Tier } from "@/lib/core/schemas";

/**
 * Inverse of the backend's LP-equivalent rank scale (`ranks.py`): each tier
 * spans 400 points, MASTER+ shares the 2800 floor and renders as "Master+".
 * Shared fixtures in `rank-display.test.ts`/`test_matchmaking_ranks.py` guard drift.
 */
const TIERS_BELOW_MASTER: Tier[] = [
  "IRON",
  "BRONZE",
  "SILVER",
  "GOLD",
  "PLATINUM",
  "EMERALD",
  "DIAMOND",
];
const DIVISIONS: Division[] = ["IV", "III", "II", "I"];
const MASTER_FLOOR = TIERS_BELOW_MASTER.length * 400;

function titleCase(tier: string): string {
  return tier.charAt(0) + tier.slice(1).toLowerCase();
}

export interface RankDisplay {
  /** Tier used for coloring via `getRankColors`. MASTER for everything 2800+. */
  tier: Tier;
  /** e.g. "Gold II · 40 LP", "Master+ 150 LP" */
  label: string;
}

export function rankValueToDisplay(value: number): RankDisplay {
  // Round first so 1599.7 promotes to "Platinum IV · 0 LP" instead of the
  // impossible "Gold I · 100 LP".
  const rounded = Math.round(Math.max(0, value));
  if (rounded >= MASTER_FLOOR) {
    return { tier: "MASTER", label: `Master+ ${rounded - MASTER_FLOOR} LP` };
  }
  // `rounded < MASTER_FLOOR` bounds both indexes; the fallbacks only satisfy
  // noUncheckedIndexedAccess.
  const tier = TIERS_BELOW_MASTER[Math.floor(rounded / 400)] ?? "IRON";
  const division = DIVISIONS[Math.floor((rounded % 400) / 100)] ?? "IV";
  return {
    tier,
    label: `${titleCase(tier)} ${division} · ${rounded % 100} LP`,
  };
}
