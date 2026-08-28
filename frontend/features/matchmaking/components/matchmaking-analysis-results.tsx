"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { unwrapOr404 } from "@/lib/core/api";
import { cn } from "@/lib/core/utils";
import { AnalyzedPlayerResultLabel } from "./analyzed-player-result-label";
import { Medal, Shield, Swords, TrendingUp } from "lucide-react";

import { formatDateTime, formatFractionAsPercent } from "@/lib/core/format";

import {
  getLatestCompletedMatchmakingAnalysis,
  getMatchmakingAnalysisStatus,
} from "../matchmaking-api";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getRankColors, rankValueToDisplay } from "@/features/players";
import { matchmakingResultsQueryKey } from "../matchmaking-query";
import { GAP_FAIRNESS_THRESHOLD, gapVerdict } from "../gap-verdict";
import { formatRunEndDate } from "../run-type";
import {
  effectiveScope as resolveScope,
  formatLpGap,
  lobbyGap,
  performanceAggregates,
  rankAggregates,
  scopeAggregates,
  winLossRecord,
  type MatchScope,
  type SidePerformance,
} from "../scope-aggregates";
import { TierDistribution } from "./tier-distribution";

interface MatchmakingAnalysisResultsProps {
  puuid: string;
  analyzedPlayerLabel: string;
  /** A run picked out of the history card; null shows the latest completed. */
  selectedCreatedAt: string | null;
  onShowLatest: () => void;
}

function RankFigure({ label, value }: { label: string; value: number }) {
  const display = rankValueToDisplay(value);
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={cn("text-sm font-medium", getRankColors(display.tier).text)}>
        {display.label}
      </dd>
    </div>
  );
}

function PerformanceRow({
  icon,
  label,
  side,
}: {
  icon: React.ReactNode;
  label: string;
  side: SidePerformance;
}) {
  const cell = (value: string | null) => (
    <TableCell className="text-right font-mono">{value ?? "—"}</TableCell>
  );
  return (
    <TableRow>
      <TableCell className="font-medium">
        <div className="flex items-center gap-2">
          {icon}
          {label}
        </div>
      </TableCell>
      {cell(
        side.damageShare !== null
          ? formatFractionAsPercent(side.damageShare)
          : null,
      )}
      {cell(side.kda !== null ? side.kda.toFixed(2) : null)}
      {cell(
        side.killParticipation !== null
          ? formatFractionAsPercent(side.killParticipation)
          : null,
      )}
    </TableRow>
  );
}

/** What the card says while it has no run to show, for either source. */
function emptyMessage(
  isSelection: boolean,
  isLoading: boolean,
  hasError: boolean,
): string {
  if (isLoading) {
    return isSelection
      ? "Loading the selected result..."
      : "Loading the latest completed result...";
  }
  if (hasError) {
    return isSelection
      ? "The selected result could not be loaded."
      : "The latest result could not be loaded.";
  }
  return isSelection
    ? "That analysis is no longer available."
    : "No completed analysis is available for this player yet.";
}

export function MatchmakingAnalysisResults({
  puuid,
  analyzedPlayerLabel,
  selectedCreatedAt,
  onShowLatest,
}: MatchmakingAnalysisResultsProps) {
  const [scope, setScope] = useState<MatchScope>("all");
  const {
    data: shownAnalysis,
    isLoading,
    error,
  } = useQuery({
    // The picked run is part of the cache identity, and the factory stays the
    // prefix `invalidateMatchmakingRun` refreshes.
    queryKey: [...matchmakingResultsQueryKey(puuid), selectedCreatedAt],
    queryFn: async ({ signal }) => {
      return unwrapOr404(
        selectedCreatedAt
          ? await getMatchmakingAnalysisStatus(puuid, selectedCreatedAt, signal)
          : await getLatestCompletedMatchmakingAnalysis(puuid, signal),
        null,
      );
    },
    retry: false,
    staleTime: 30000,
  });
  const cardTitle = selectedCreatedAt
    ? "Selected Analysis Result"
    : "Last Analysis Result";
  const showLatestButton = selectedCreatedAt ? (
    <button
      type="button"
      onClick={onShowLatest}
      className="cursor-pointer text-sm text-primary hover:underline"
    >
      Show latest
    </button>
  ) : null;

  if (
    isLoading ||
    error ||
    !shownAnalysis ||
    shownAnalysis.status !== "completed"
  ) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              {cardTitle}
            </CardTitle>
            {showLatestButton}
          </div>
          <AnalyzedPlayerResultLabel playerLabel={analyzedPlayerLabel} />
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {emptyMessage(Boolean(selectedCreatedAt), isLoading, Boolean(error))}
        </CardContent>
      </Card>
    );
  }

  const { results } = shownAnalysis;
  const perMatch = results.per_match ?? null;
  const soloAggregates = perMatch ? scopeAggregates(perMatch, "solo") : null;
  const duoAggregates = perMatch ? scopeAggregates(perMatch, "duo") : null;
  const effectiveScope = resolveScope(scope, soloAggregates, duoAggregates);
  // The "All" scope always shows the stored aggregate -- never a client
  // recomputation, so it cannot drift from the history card's figures.
  const scoped =
    effectiveScope === "solo" && soloAggregates
      ? soloAggregates
      : effectiveScope === "duo" && duoAggregates
        ? duoAggregates
        : {
            teamAvg: results.team_avg_winrate,
            enemyAvg: results.enemy_avg_winrate,
            matchCount: perMatch?.length ?? null,
          };

  const { params } = shownAnalysis;
  const spineFound = results.spine_matches_found ?? null;
  const windowCount =
    spineFound !== null && spineFound < params.match_count
      ? `${spineFound} of ${params.match_count}`
      : `${params.match_count}`;
  const windowLabel = params.end_date
    ? `${windowCount} Matches through ${formatRunEndDate(params.end_date)}`
    : `Last ${windowCount} Matches`;
  const winrateDiff = scoped.teamAvg - scoped.enemyAvg;
  const winrateDiffPercent = formatFractionAsPercent(Math.abs(winrateDiff));
  const {
    verdict,
    ally: allyColor,
    enemy: enemyColor,
  } = gapVerdict(winrateDiff, GAP_FAIRNESS_THRESHOLD);

  const performance = perMatch
    ? performanceAggregates(perMatch, effectiveScope)
    : null;
  // Ranks re-slice with the dropdown when the run stored per-match puuids;
  // older runs fall back to the run-wide figures, captioned as such below.
  const scopedRanks =
    effectiveScope !== "all" && perMatch
      ? rankAggregates(
          perMatch,
          results.player_ranks,
          effectiveScope,
          shownAnalysis.puuid,
        )
      : null;
  const allyRank = scopedRanks
    ? scopedRanks.allyAvg
    : (results.ally_avg_rank_value ?? null);
  const enemyRank = scopedRanks
    ? scopedRanks.enemyAvg
    : (results.enemy_avg_rank_value ?? null);
  const allyTiers = scopedRanks
    ? scopedRanks.allyTierCounts
    : (results.ally_tier_counts ?? null);
  const enemyTiers = scopedRanks
    ? scopedRanks.enemyTierCounts
    : (results.enemy_tier_counts ?? null);
  const ranksAreRunWide = effectiveScope !== "all" && !scopedRanks;
  const freshness = results.rank_freshness ?? null;
  const record = perMatch ? winLossRecord(perMatch, effectiveScope) : null;
  const gap = perMatch
    ? lobbyGap(
        perMatch,
        results.player_ranks,
        effectiveScope,
        shownAnalysis.puuid,
      )
    : null;
  const gapLp = gap ? Math.round(gap.lobbyAvg - gap.playerValue) : 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            {cardTitle}
          </CardTitle>
          <div className="flex items-center gap-3">
            {showLatestButton}
            <span className="text-sm text-muted-foreground">
              {formatDateTime(shownAnalysis.created_at)}
            </span>
          </div>
        </div>
        <AnalyzedPlayerResultLabel playerLabel={analyzedPlayerLabel} />
      </CardHeader>
      <CardContent className="space-y-4">
        {perMatch && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">
              {duoAggregates
                ? `${duoAggregates.matchCount} likely duo / ${
                    soloAggregates?.matchCount ?? 0
                  } solo matches (inferred)`
                : "No duo games detected in this run"}
            </span>
            <Select
              value={effectiveScope}
              onValueChange={(value) => setScope(value as MatchScope)}
            >
              <SelectTrigger
                className="w-[120px]"
                aria-label="Match scope filter"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="solo" disabled={!soloAggregates}>
                  SoloQ
                </SelectItem>
                <SelectItem value="duo" disabled={!duoAggregates}>
                  DuoQ
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Team</TableHead>
              <TableHead className="text-right">
                Average Winrate ({windowLabel})
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-medium">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  Teammates
                </div>
              </TableCell>
              <TableCell className="text-right font-mono">
                <span className={allyColor}>
                  {formatFractionAsPercent(scoped.teamAvg)}
                </span>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium">
                <div className="flex items-center gap-2">
                  <Swords className="h-4 w-4" />
                  Opponents
                </div>
              </TableCell>
              <TableCell className="text-right font-mono">
                <span className={enemyColor}>
                  {formatFractionAsPercent(scoped.enemyAvg)}
                </span>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>

        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Based on {results.matches_analyzed} ranked matches
            {effectiveScope !== "all" && scoped.matchCount !== null
              ? ` · ${scoped.matchCount} of this run's matches in scope`
              : ""}
          </p>

          {record && (
            <p className="text-sm text-muted-foreground">
              Analyzed player&apos;s record in these matches:{" "}
              <span className="font-mono font-medium text-foreground">
                {record.wins}W – {record.losses}L
              </span>
            </p>
          )}

          {verdict === "favorable" && (
            <p className="text-sm text-green-400">
              ✓ The analyzed player&apos;s teammates had higher average win
              rates than opponents by{" "}
              <span className="font-bold">{winrateDiffPercent}</span>
            </p>
          )}
          {verdict === "unfavorable" && (
            <p className="text-sm text-red-400">
              ✗ The analyzed player&apos;s opponents had higher average win
              rates than teammates by{" "}
              <span className="font-bold">{winrateDiffPercent}</span>
            </p>
          )}
          {verdict === "fair" && (
            <p className="text-sm text-muted-foreground">
              ≈ Matchmaking relatively fair (win rates within 3%)
            </p>
          )}
        </div>

        {performance && (
          <div className="space-y-2 border-t border-border/40 pt-4">
            <p className="text-sm font-medium">Recent Form</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Team</TableHead>
                  <TableHead className="text-right">Damage Share</TableHead>
                  <TableHead className="text-right">KDA</TableHead>
                  <TableHead className="text-right">Kill Part.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <PerformanceRow
                  icon={<Shield className="h-4 w-4" />}
                  label="Teammates"
                  side={performance.team}
                />
                <PerformanceRow
                  icon={<Swords className="h-4 w-4" />}
                  label="Opponents"
                  side={performance.enemy}
                />
              </TableBody>
            </Table>
            <p className="text-sm text-muted-foreground">
              Each player&apos;s form over the same recent matches the win
              rates use: median KDA, plus their share of team kills and team
              damage.
            </p>
          </div>
        )}

        {(allyRank !== null || enemyRank !== null) && (
          <div className="space-y-2 border-t border-border/40 pt-4">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Medal className="h-4 w-4 text-primary" />
              Average Rank
            </p>
            <dl className="grid grid-cols-2 gap-2">
              {allyRank !== null && (
                <RankFigure label="Allies" value={allyRank} />
              )}
              {enemyRank !== null && (
                <RankFigure label="Enemies" value={enemyRank} />
              )}
            </dl>
            {allyRank !== null &&
              enemyRank !== null &&
              Math.round(Math.abs(enemyRank - allyRank)) > 0 && (
                <p className="text-sm text-muted-foreground">
                  {enemyRank > allyRank ? "Enemies" : "Allies"} average{" "}
                  {formatLpGap(enemyRank - allyRank)} higher.
                </p>
              )}
            {gap && gapLp !== 0 && (
              <p className="text-sm text-muted-foreground">
                The other players in these lobbies average{" "}
                <span
                  className={cn(
                    "font-medium",
                    getRankColors(rankValueToDisplay(gap.lobbyAvg).tier).text,
                  )}
                >
                  {rankValueToDisplay(gap.lobbyAvg).label}
                </span>{" "}
                — {formatLpGap(gapLp)} {gapLp > 0 ? "above" : "below"} the
                analyzed player&apos;s own rank.
              </p>
            )}
            {ranksAreRunWide && (
              <p className="text-sm text-muted-foreground">
                Rank figures cover the whole run; this run predates per-scope
                ranks.
              </p>
            )}
            {freshness && freshness.current_day > 0 && (
              <p className="text-sm text-muted-foreground">
                {freshness.period_accurate} ranks measured near the analyzed
                period, {freshness.current_day} are current-day (no historical
                rank data existed for them yet).
              </p>
            )}
          </div>
        )}

        {allyTiers && enemyTiers && (
          <div className="space-y-2 border-t border-border/40 pt-4">
            <p className="text-sm font-medium">Tier Distribution</p>
            <TierDistribution
              allyCounts={allyTiers}
              enemyCounts={enemyTiers}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
