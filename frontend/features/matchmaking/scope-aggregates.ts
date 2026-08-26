import type { MatchmakingPerMatch } from "@/lib/core/schemas";

export type MatchScope = "all" | "solo" | "duo";

export interface ScopeAggregates {
  teamAvg: number;
  enemyAvg: number;
  matchCount: number;
}

/**
 * Recompute the two headline averages for one duo scope from the persisted
 * per-match breakdown. The "All" scope must NOT go through this: the card
 * shows the stored `team_avg_winrate`/`enemy_avg_winrate` for it, so the
 * figure can never drift from what history shows (per-match values are
 * rounded to 4 decimals before storage).
 */
export function scopeAggregates(
  perMatch: MatchmakingPerMatch[],
  scope: Exclude<MatchScope, "all">,
): ScopeAggregates | null {
  const scoped = perMatch.filter((m) => m.duo === (scope === "duo"));
  if (scoped.length === 0) {
    return null;
  }
  const mean = (values: number[]) =>
    values.reduce((sum, v) => sum + v, 0) / values.length;
  return {
    teamAvg: mean(scoped.map((m) => m.team_avg)),
    enemyAvg: mean(scoped.map((m) => m.enemy_avg)),
    matchCount: scoped.length,
  };
}
