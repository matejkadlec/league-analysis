"use client";

import { useQuery } from "@tanstack/react-query";
import { ApiRequestError } from "@/lib/core/api";
import { TrendingUp, Users } from "lucide-react";

import { formatDateTime } from "@/lib/core/format";

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

interface MatchmakingAnalysisResultsProps {
  puuid: string;
  analyzedPlayerLabel: string;
}

function AnalyzedPlayerResultLabel({ playerLabel }: { playerLabel: string }) {
  return (
    <p className="text-sm">
      <span style={{ color: "var(--color-muted-foreground)" }}>
        Results for player{" "}
      </span>
      <span style={{ color: "var(--color-card-foreground)" }}>
        {playerLabel}
      </span>
    </p>
  );
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
    queryKey: ["matchmaking-analysis-results", puuid],
    queryFn: async () => {
      const result = await getLatestCompletedMatchmakingAnalysis(puuid);
      if (!result.success) {
        if (result.error.status === 404) {
          return null;
        }
        throw new ApiRequestError(result.error);
      }
      return result.data;
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
  // Rows stored before the basis formula was fixed carry 820, because the
  // backend counted `10 + 90 * (MATCHES_FOR_WINRATE - 1)` where it now counts
  // `10 + 90 * MATCHES_FOR_WINRATE` (`matchmaking_analysis/service.py`,
  // `_build_completion_results`). Without this, two analyses that looked at
  // the same amount disagree about how much that was. The real fix is a
  // migration of the stored rows; until then this stays, and deleting it
  // fails `matchmaking-analysis-results.test.tsx`.
  const displayMatchesAnalyzed =
    matches_analyzed === 820 ? 910 : matches_analyzed;

  // Calculate the difference to show if matchmaking was fair
  const winrateDiff = team_avg_winrate - enemy_avg_winrate;
  const winrateDiffPercent = Math.abs(winrateDiff * 100).toFixed(1);
  const isFavorable = winrateDiff >= 0.03;
  const isUnfavorable = winrateDiff <= -0.03;
  const isFair = !isFavorable && !isUnfavorable;

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
                <span
                  className={
                    isFavorable
                      ? "text-green-600 dark:text-green-400"
                      : isUnfavorable
                        ? "text-red-600 dark:text-red-400"
                        : ""
                  }
                >
                  {(team_avg_winrate * 100).toFixed(1)}%
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
                <span
                  className={
                    isUnfavorable
                      ? "text-green-600 dark:text-green-400"
                      : isFavorable
                        ? "text-red-600 dark:text-red-400"
                        : ""
                  }
                >
                  {(enemy_avg_winrate * 100).toFixed(1)}%
                </span>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>

        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Based on {displayMatchesAnalyzed} ranked matches
          </p>

          {isFavorable && (
            <p className="text-sm text-green-600 dark:text-green-400">
              ✓ The analyzed player&apos;s teammates had higher average win
              rates than opponents by{" "}
              <span className="font-bold">{winrateDiffPercent}%</span>
            </p>
          )}
          {isUnfavorable && (
            <p className="text-sm text-red-600 dark:text-red-400">
              ✗ The analyzed player&apos;s opponents had higher average win
              rates than teammates by{" "}
              <span className="font-bold">{winrateDiffPercent}%</span>
            </p>
          )}
          {isFair && (
            <p className="text-sm text-muted-foreground">
              ≈ Matchmaking relatively fair (win rates within 3%)
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
