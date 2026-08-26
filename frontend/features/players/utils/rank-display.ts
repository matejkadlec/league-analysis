import type { Tier } from "@/lib/core/schemas";

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
const DIVISIONS = ["IV", "III", "II", "I"];
const MASTER_FLOOR = TIERS_BELOW_MASTER.length * 400;

function titleCase(tier: string): string {
  return tier.charAt(0) + tier.slice(1).toLowerCase();
}

export interface RankDisplay {
  /** Tier used for coloring via `getRankColors`. MASTER for everything 2800+. */
  tier: Tier;
  /** e.g. "Gold II", "Master+ 150 LP" */
  label: string;
}

export function rankValueToDisplay(value: number): RankDisplay {
  if (value >= MASTER_FLOOR) {
    return { tier: "MASTER", label: `Master+ ${Math.round(value - MASTER_FLOOR)} LP` };
  }
  const clamped = Math.max(0, value);
  // `value < MASTER_FLOOR` bounds both indexes; the fallbacks only satisfy
  // noUncheckedIndexedAccess.
  const tier = TIERS_BELOW_MASTER[Math.floor(clamped / 400)] ?? "IRON";
  const division = DIVISIONS[Math.floor((clamped % 400) / 100)] ?? "IV";
  return { tier, label: `${titleCase(tier)} ${division}` };
}
