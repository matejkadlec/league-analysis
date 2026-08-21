"use client";

import { useQuery } from "@tanstack/react-query";
import { unwrapOr404 } from "@/lib/core/api";
import { AnalyzedPlayerResultLabel } from "./analyzed-player-result-label";
import { TrendingUp, Users } from "lucide-react";

import { formatDateTime, formatFractionAsPercent } from "@/lib/core/format";

import { getLatestCompletedMatchmakingAnalysis } from "../matchmaking-api";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { matchmakingResultsQueryKey } from "../matchmaking-query";
import { GAP_FAIRNESS_THRESHOLD, gapVerdict } from "../gap-verdict";

interface MatchmakingAnalysisResultsProps {
  puuid: string;
  analyzedPlayerLabel: string;
}

export function MatchmakingAnalysisResults({
  puuid,
  analyzedPlayerLabel,
}: MatchmakingAnalysisResultsProps) {
  const {
    data: latestAnalysis,
    isLoading,
    error,
  } = useQuery({
    queryKey: matchmakingResultsQueryKey(puuid),
    queryFn: async () => {
      return unwrapOr404(
        await getLatestCompletedMatchmakingAnalysis(puuid),
        null,
      );
    },
    retry: false,
    staleTime: 30000,
  });

  if (
    isLoading ||
    error ||
    !latestAnalysis ||
    latestAnalysis.status !== "completed"
  ) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            Last Analysis Result
          </CardTitle>
          <AnalyzedPlayerResultLabel playerLabel={analyzedPlayerLabel} />
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {isLoading
            ? "Loading the latest completed result..."
            : error
              ? "The latest result could not be loaded."
              : "No completed analysis is available for this player yet."}
        </CardContent>
      </Card>
    );
  }

  const { team_avg_winrate, enemy_avg_winrate, matches_analyzed } =
    latestAnalysis.results;

  // Calculate the difference to show if matchmaking was fair
  const winrateDiff = team_avg_winrate - enemy_avg_winrate;
  const winrateDiffPercent = formatFractionAsPercent(Math.abs(winrateDiff));
  const {
    verdict,
    ally: allyColor,
    enemy: enemyColor,
  } = gapVerdict(winrateDiff, GAP_FAIRNESS_THRESHOLD);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            Last Analysis Result
          </CardTitle>
          <span className="text-sm text-muted-foreground">
            {formatDateTime(latestAnalysis.created_at)}
          </span>
        </div>
        <AnalyzedPlayerResultLabel playerLabel={analyzedPlayerLabel} />
      </CardHeader>
      <CardContent className="space-y-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Team</TableHead>
              <TableHead className="text-right">
                Average Winrate (Last 10 Matches)
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-medium">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Analyzed Player&apos;s Team
                </div>
              </TableCell>
              <TableCell className="text-right font-mono">
                <span className={allyColor}>
                  {formatFractionAsPercent(team_avg_winrate)}
                </span>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Opponent Team
                </div>
              </TableCell>
              <TableCell className="text-right font-mono">
                <span className={enemyColor}>
                  {formatFractionAsPercent(enemy_avg_winrate)}
                </span>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>

        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Based on {matches_analyzed} ranked matches
          </p>

          {verdict === "favorable" && (
            <p className="text-sm text-green-600 dark:text-green-400">
              ✓ The analyzed player&apos;s teammates had higher average win
              rates than opponents by{" "}
              <span className="font-bold">{winrateDiffPercent}</span>
            </p>
          )}
          {verdict === "unfavorable" && (
            <p className="text-sm text-red-600 dark:text-red-400">
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
      </CardContent>
    </Card>
  );
}
