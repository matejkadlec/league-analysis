"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/core/utils";
import { AnalyzedPlayerResultLabel } from "./analyzed-player-result-label";
import {
  Medal,
  Scale,
  Shield,
  Swords,
  TrendingUp,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

import { formatDateTime, formatFractionAsPercent } from "@/lib/core/format";

import { SectionRow } from "@/components/page-sections";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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
import { gapVerdict } from "../gap-verdict";
import { GapFigure } from "./gap-figure";
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
import { useShownMatchmakingAnalysis } from "./use-shown-matchmaking-analysis";

interface MatchmakingAnalysisResultsProps {
  puuid: string;
  analyzedPlayerLabel: string;
  /** A run picked out of the history; null shows the latest completed. */
  selectedCreatedAt: string | null;
  onShowLatest: () => void;
}

// The one place a plain string still becomes a `MatchScope`: Radix types
// Select's onValueChange as (value: string) => void.
function isMatchScope(value: string): value is MatchScope {
  return value === "all" || value === "solo" || value === "duo";
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

/** What the cards say while they have no run to show, for either source. */
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

const SCOPE_CAPTIONS: Record<MatchScope, string> = {
  all: "All matches of this run",
  solo: "SoloQ matches of this run only",
  duo: "DuoQ matches of this run only",
};

/**
 * One of the two result cards. Both name the player and the run they show, so
 * either card read on its own says which analysis it belongs to.
 */
function ResultCard({
  id,
  icon: Icon,
  title,
  action,
  playerLabel,
  runCaption,
  children,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  action?: ReactNode;
  playerLabel: string;
  runCaption: string | null;
  children: ReactNode;
}) {
  return (
    <Card id={id} data-testid={id} className="flex flex-col">
      <CardHeader>
        <div className="flex min-h-9 items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-primary" />
            {title}
          </CardTitle>
          {action}
        </div>
        <AnalyzedPlayerResultLabel playerLabel={playerLabel} />
        {runCaption && (
          <p className="text-sm text-muted-foreground">{runCaption}</p>
        )}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">{children}</CardContent>
    </Card>
  );
}

// Roughly the loaded cards' content, so the history and flowchart below do
// not jump when a result lands. An empty or failed load shows one line.
function WinRatesSkeleton() {
  return (
    <>
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-36 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-44 w-full" />
    </>
  );
}

function RanksSkeleton() {
  return (
    <>
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-56 w-full" />
    </>
  );
}

/** The result row before there is a player to load it for. */
export function MatchmakingAnalysisResultsSkeleton() {
  return (
    <SectionRow>
      <Card aria-busy="true">
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-56" />
        </CardHeader>
        <CardContent className="space-y-4">
          <WinRatesSkeleton />
        </CardContent>
      </Card>
      <Card aria-busy="true">
        <CardHeader>
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-56" />
        </CardHeader>
        <CardContent className="space-y-4">
          <RanksSkeleton />
        </CardContent>
      </Card>
    </SectionRow>
  );
}

export function MatchmakingAnalysisResults({
  puuid,
  analyzedPlayerLabel,
  selectedCreatedAt,
  onShowLatest,
}: MatchmakingAnalysisResultsProps) {
  // Owned here, above both cards: the scope picked on the win-rate card
  // re-slices the ranks card too, and each must say which slice it shows.
  const [scope, setScope] = useState<MatchScope>("all");
  const {
    data: shownAnalysis,
    isLoading,
    error,
  } = useShownMatchmakingAnalysis(puuid, selectedCreatedAt);
  const isSelection = Boolean(selectedCreatedAt);
  const showLatestButton = isSelection ? (
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
    // The same two cards as a loaded result, so nothing moves when it lands.
    const message = emptyMessage(isSelection, isLoading, Boolean(error));
    return (
      <SectionRow>
        <ResultCard
          id="matchmaking-win-rates"
          icon={TrendingUp}
          title="Win Rates & Verdict"
          action={showLatestButton}
          playerLabel={analyzedPlayerLabel}
          runCaption={null}
        >
          <p className="text-sm text-muted-foreground">{message}</p>
          {isLoading && <WinRatesSkeleton />}
        </ResultCard>
        <ResultCard
          id="matchmaking-ranks"
          icon={Medal}
          title="Ranks"
          playerLabel={analyzedPlayerLabel}
          runCaption={null}
        >
          <p className="text-sm text-muted-foreground">{message}</p>
          {isLoading && <RanksSkeleton />}
        </ResultCard>
      </SectionRow>
    );
  }

  const { results } = shownAnalysis;
  const perMatch = results.per_match ?? null;
  const soloAggregates = perMatch ? scopeAggregates(perMatch, "solo") : null;
  const duoAggregates = perMatch ? scopeAggregates(perMatch, "duo") : null;
  const effectiveScope = resolveScope(scope, soloAggregates, duoAggregates);
  // The "All" scope always shows the stored aggregate -- never a client
  // recomputation, so it cannot drift from the history's figures.
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
  const runCaption = `${isSelection ? "Selected run" : "Latest run"} · ${formatDateTime(
    shownAnalysis.created_at,
  )} · ${windowLabel}`;
  const winrateDiff = scoped.teamAvg - scoped.enemyAvg;
  const winrateDiffPercent = formatFractionAsPercent(Math.abs(winrateDiff));
  const gap = gapVerdict(winrateDiff);

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
  const hasRanks = allyRank !== null || enemyRank !== null;
  const hasTiers = Boolean(allyTiers && enemyTiers);
  const freshness = results.rank_freshness ?? null;
  const degradedPlayers = results.degraded_players ?? 0;
  const record = perMatch ? winLossRecord(perMatch, effectiveScope) : null;
  const lobby = perMatch
    ? lobbyGap(
        perMatch,
        results.player_ranks,
        effectiveScope,
        shownAnalysis.puuid,
      )
    : null;
  const gapLp = lobby ? Math.round(lobby.lobbyAvg - lobby.playerValue) : 0;

  return (
    <SectionRow>
      <ResultCard
        id="matchmaking-win-rates"
        icon={TrendingUp}
        title="Win Rates & Verdict"
        action={showLatestButton}
        playerLabel={analyzedPlayerLabel}
        runCaption={runCaption}
      >
        {degradedPlayers > 0 && (
          // The run completed, but not on everything it asked Riot for, and
          // the figures below cannot show that on their own. A status, not an
          // alert: it is a caption and must not interrupt on every mount.
          <Alert role="status" data-testid="matchmaking-degraded-notice">
            <TriangleAlert className="h-4 w-4" />
            <AlertDescription>
              Riot data could not be loaded for {degradedPlayers}{" "}
              {degradedPlayers === 1 ? "player" : "players"} in this run.
              Their win rate is left out unless enough of their matches were
              already stored, and their rank may show as Unranked.
            </AlertDescription>
          </Alert>
        )}
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
              onValueChange={(value) =>
                setScope(isMatchScope(value) ? value : "all")
              }
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
              <TableHead className="text-right">Average Win Rate</TableHead>
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
                {formatFractionAsPercent(scoped.teamAvg)}
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
                {formatFractionAsPercent(scoped.enemyAvg)}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium">
                <div className="flex items-center gap-2">
                  <Scale className="h-4 w-4" />
                  Gap
                </div>
              </TableCell>
              <TableCell
                className="text-right font-mono"
                data-testid="matchmaking-result-gap"
              >
                <GapFigure gap={winrateDiff} />
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

          {gap.verdict === "favorable" && (
            <p className={cn("text-sm", gap.tone)}>
              {gap.symbol} The analyzed player&apos;s teammates had higher
              average win rates than opponents by{" "}
              <span className="font-bold">{winrateDiffPercent}</span>
            </p>
          )}
          {gap.verdict === "unfavorable" && (
            <p className={cn("text-sm", gap.tone)}>
              {gap.symbol} The analyzed player&apos;s opponents had higher
              average win rates than teammates by{" "}
              <span className="font-bold">{winrateDiffPercent}</span>
            </p>
          )}
          {gap.verdict === "fair" && (
            <p className="text-sm text-muted-foreground">
              {gap.symbol} Matchmaking relatively fair (win rates within 3%)
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
      </ResultCard>

      <ResultCard
        id="matchmaking-ranks"
        icon={Medal}
        title="Ranks"
        playerLabel={analyzedPlayerLabel}
        runCaption={runCaption}
      >
        {perMatch && (
          <p className="text-sm text-muted-foreground">
            Scope: {SCOPE_CAPTIONS[effectiveScope]}
          </p>
        )}

        {hasRanks && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Average Rank</p>
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
            {lobby && gapLp !== 0 && (
              <p className="text-sm text-muted-foreground">
                The other players in these lobbies average{" "}
                <span
                  className={cn(
                    "font-medium",
                    getRankColors(rankValueToDisplay(lobby.lobbyAvg).tier)
                      .text,
                  )}
                >
                  {rankValueToDisplay(lobby.lobbyAvg).label}
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

        {hasTiers && allyTiers && enemyTiers && (
          <div
            className={cn(
              "flex flex-1 flex-col gap-2",
              hasRanks && "border-t border-border/40 pt-4",
            )}
          >
            <p className="text-sm font-medium">Tier Distribution</p>
            <TierDistribution
              allyCounts={allyTiers}
              enemyCounts={enemyTiers}
              fillHeight
            />
          </div>
        )}

        {!hasRanks && !hasTiers && (
          <p className="text-sm text-muted-foreground">
            This run predates rank analysis, so it has no rank figures. A new
            analysis of this player measures them.
          </p>
        )}
      </ResultCard>
    </SectionRow>
  );
}
