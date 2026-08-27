import type {
  LobbyTier,
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
  allyTierCounts: Partial<Record<LobbyTier, number>>;
  enemyTierCounts: Partial<Record<LobbyTier, number>>;
}

function sideRanks(
  puuids: Set<string>,
  playerRanks: Record<string, MatchmakingPlayerRank>,
): { avg: number | null; tierCounts: Partial<Record<LobbyTier, number>> } {
  const tierCounts: Partial<Record<LobbyTier, number>> = {};
  const values: number[] = [];
  for (const puuid of puuids) {
    const rank = playerRanks[puuid];
    const tier: LobbyTier = rank?.tier ?? "UNRANKED";
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
 * backend run-wide semantics. Excludes the analyzed player — the constant in
 * every lobby. Null when the run predates the per-match puuid lists.
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
  const allies = new Set<string>();
  const enemies = new Set<string>();
  for (const m of scoped) {
    for (const puuid of m.ally_puuids ?? []) allies.add(puuid);
    for (const puuid of m.enemy_puuids ?? []) enemies.add(puuid);
  }
  allies.delete(analysisPuuid);
  const ally = sideRanks(allies, playerRanks);
  const enemy = sideRanks(enemies, playerRanks);
  return {
    allyAvg: ally.avg,
    enemyAvg: enemy.avg,
    allyTierCounts: ally.tierCounts,
    enemyTierCounts: enemy.tierCounts,
  };
}

export interface WinLossRecord {
  wins: number;
  losses: number;
}

/**
 * The analyzed player's own W-L record over one scope's matches. Null when no
 * scoped match carries the win flag (runs stored before it existed).
 */
export function winLossRecord(
  perMatch: MatchmakingPerMatch[],
  scope: MatchScope,
): WinLossRecord | null {
  const scoped =
    scope === "all"
      ? perMatch
      : perMatch.filter((m) => m.duo === (scope === "duo"));
  const flags = scoped.map((m) => m.win).filter((w): w is boolean => w != null);
  if (flags.length === 0) return null;
  const wins = flags.filter(Boolean).length;
  return { wins, losses: flags.length - wins };
}

export interface LobbyGap {
  lobbyAvg: number;
  playerValue: number;
}

/**
 * Average rank of every other unique player in one scope's lobbies (both
 * sides, analyzed player excluded) against the analyzed player's own rank.
 * Null when the run lacks per-match puuids, or either figure is unrankable.
 */
export function lobbyGap(
  perMatch: MatchmakingPerMatch[],
  playerRanks: Record<string, MatchmakingPlayerRank> | null | undefined,
  scope: MatchScope,
  analysisPuuid: string,
): LobbyGap | null {
  if (!playerRanks) return null;
  const playerValue = playerRanks[analysisPuuid]?.value;
  if (playerValue == null) return null;
  const scoped =
    scope === "all"
      ? perMatch
      : perMatch.filter((m) => m.duo === (scope === "duo"));
  if (
    scoped.length === 0 ||
    scoped.some((m) => m.ally_puuids == null || m.enemy_puuids == null)
  ) {
    return null;
  }
  const lobby = new Set<string>();
  for (const m of scoped) {
    for (const puuid of m.ally_puuids ?? []) lobby.add(puuid);
    for (const puuid of m.enemy_puuids ?? []) lobby.add(puuid);
  }
  lobby.delete(analysisPuuid);
  const values = [...lobby]
    .map((puuid) => playerRanks[puuid]?.value)
    .filter((v): v is number => v != null);
  if (values.length === 0) return null;
  return {
    lobbyAvg: values.reduce((sum, v) => sum + v, 0) / values.length,
    playerValue,
  };
}

/**
 * An LP delta phrased in League's own units — "3 divisions and 94 LP",
 * "1 division", or "94 LP" (a division spans 100 LP).
 */
export function formatLpGap(lp: number): string {
  const abs = Math.round(Math.abs(lp));
  const divisions = Math.floor(abs / 100);
  const rest = abs % 100;
  const parts: string[] = [];
  if (divisions > 0) {
    parts.push(`${divisions} division${divisions === 1 ? "" : "s"}`);
  }
  if (rest > 0 || divisions === 0) parts.push(`${rest} LP`);
  return parts.join(" and ");
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
