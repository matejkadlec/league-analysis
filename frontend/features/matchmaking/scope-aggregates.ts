import type {
  MatchmakingPerMatch,
  MatchmakingPlayerRank,
} from "@/lib/core/schemas";

export type MatchScope = "all" | "solo" | "duo";

export interface ScopeAggregates {
  teamAvg: number;
  enemyAvg: number;
  matchCount: number;
}

/**
 * Recompute the two headline averages for one duo scope from the persisted
 * per-match breakdown. The "All" scope must NOT go through this: the card
 * shows the stored aggregates for it, so the figure never drifts from history.
 */
/**
 * The scope the card may actually render: a selection whose aggregates are
 * gone (player switch, new run, deletion) snaps back to "all", so the Select
 * and captions can never label the stored All-scope figures as a slice.
 */
export function effectiveScope(
  selected: MatchScope,
  soloAggregates: ScopeAggregates | null,
  duoAggregates: ScopeAggregates | null,
): MatchScope {
  if (selected === "solo" && soloAggregates) return "solo";
  if (selected === "duo" && duoAggregates) return "duo";
  return "all";
}

/**
 * Mean with 10% trimmed from each end (floor'd count, so under ten values
 * nothing is trimmed). Mirrors `trimmed_mean` in the backend service; the
 * fixtures duplicated across both test suites must stay identical.
 */
export function trimmedMean(values: number[]): number {
  const k = Math.floor(values.length * 0.1);
  const kept = [...values].sort((a, b) => a - b).slice(k, values.length - k);
  return kept.reduce((sum, v) => sum + v, 0) / kept.length;
}

export function scopeAggregates(
  perMatch: MatchmakingPerMatch[],
  scope: Exclude<MatchScope, "all">,
): ScopeAggregates | null {
  const scoped = perMatch.filter((m) => m.duo === (scope === "duo"));
  if (scoped.length === 0) {
    return null;
  }
  return {
    teamAvg: trimmedMean(scoped.map((m) => m.team_avg)),
    enemyAvg: trimmedMean(scoped.map((m) => m.enemy_avg)),
    matchCount: scoped.length,
  };
}

export interface RankAggregates {
  allyAvg: number | null;
  enemyAvg: number | null;
  allyTierCounts: Record<string, number>;
  enemyTierCounts: Record<string, number>;
}

function sideRanks(
  puuids: Set<string>,
  playerRanks: Record<string, MatchmakingPlayerRank>,
): { avg: number | null; tierCounts: Record<string, number> } {
  const tierCounts: Record<string, number> = {};
  const values: number[] = [];
  for (const puuid of puuids) {
    const rank = playerRanks[puuid];
    const tier = rank?.tier ?? "UNRANKED";
    tierCounts[tier] = (tierCounts[tier] ?? 0) + 1;
    if (rank?.value != null) values.push(rank.value);
  }
  const avg =
    values.length > 0
      ? values.reduce((sum, v) => sum + v, 0) / values.length
      : null;
  return { avg, tierCounts };
}

/**
 * Rank averages and tier buckets over one scope's unique players, mirroring
 * the backend's run-wide semantics (plain mean over ranked players, unranked
 * bucketed). Null when the run predates the per-match puuid lists.
 */
export function rankAggregates(
  perMatch: MatchmakingPerMatch[],
  playerRanks: Record<string, MatchmakingPlayerRank> | null | undefined,
  scope: Exclude<MatchScope, "all">,
  analysisPuuid: string,
): RankAggregates | null {
  if (!playerRanks) return null;
  const scoped = perMatch.filter((m) => m.duo === (scope === "duo"));
  if (scoped.length === 0) return null;
  if (scoped.some((m) => m.ally_puuids == null || m.enemy_puuids == null)) {
    return null;
  }
  const allies = new Set<string>([analysisPuuid]);
  const enemies = new Set<string>();
  for (const m of scoped) {
    for (const puuid of m.ally_puuids ?? []) allies.add(puuid);
    for (const puuid of m.enemy_puuids ?? []) enemies.add(puuid);
  }
  const ally = sideRanks(allies, playerRanks);
  const enemy = sideRanks(enemies, playerRanks);
  return {
    allyAvg: ally.avg,
    enemyAvg: enemy.avg,
    allyTierCounts: ally.tierCounts,
    enemyTierCounts: enemy.tierCounts,
  };
}

export interface SidePerformance {
  kda: number | null;
  killParticipation: number | null;
  damageShare: number | null;
}

export interface PerformanceAggregates {
  team: SidePerformance;
  enemy: SidePerformance;
}

/**
 * Per-side trailing-form aggregates for one scope, each metric averaged over
 * only the matches that carry it -- a null (or legacy-absent) value never
 * drags a side to NaN, and a scope with no metric anywhere returns null.
 */
export function performanceAggregates(
  perMatch: MatchmakingPerMatch[],
  scope: MatchScope,
): PerformanceAggregates | null {
  const scoped =
    scope === "all"
      ? perMatch
      : perMatch.filter((m) => m.duo === (scope === "duo"));
  const metric = (values: (number | null | undefined)[]): number | null => {
    const present = values.filter((v): v is number => v != null);
    return present.length > 0 ? trimmedMean(present) : null;
  };
  const side = (prefix: "team" | "enemy"): SidePerformance => ({
    kda: metric(scoped.map((m) => m[`${prefix}_kda`])),
    killParticipation: metric(scoped.map((m) => m[`${prefix}_kill_participation`])),
    damageShare: metric(scoped.map((m) => m[`${prefix}_damage_share`])),
  });
  const team = side("team");
  const enemy = side("enemy");
  const empty = (s: SidePerformance) =>
    s.kda === null && s.killParticipation === null && s.damageShare === null;
  if (empty(team) && empty(enemy)) {
    return null;
  }
  return { team, enemy };
}
