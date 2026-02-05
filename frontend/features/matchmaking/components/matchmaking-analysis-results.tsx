"use client";

import { useQuery } from "@tanstack/react-query";
import { TrendingUp, Users } from "lucide-react";

import { getLatestMatchmakingAnalysis } from "@/lib/core/api";

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
}

/**
 * Format date/time as DD/MM/YYYY H:MM AM|PM (no leading zeros except minutes)
 */
function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const year = date.getFullYear();

  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  hours = hours ? hours : 12; // the hour '0' should be '12'

  const minutesStr = minutes < 10 ? `0${minutes}` : minutes;

  return `${day}/${month}/${year} ${hours}:${minutesStr} ${ampm}`;
}

export function MatchmakingAnalysisResults({
  puuid,
}: MatchmakingAnalysisResultsProps) {
  const {
    data: latestAnalysis,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["matchmaking-analysis-results", puuid],
    queryFn: async () => {
      const result = await getLatestMatchmakingAnalysis(puuid);
      if (!result.success) {
        if (result.error.status === 404) {
          return null;
        }
        throw new Error(result.error.message);
      }
      return result.data;
    },
    retry: false,
    staleTime: 30000,
  });

  // Debug logging
  console.log("MatchmakingAnalysisResults debug:", {
    isLoading,
    error,
    latestAnalysis,
    hasResults: latestAnalysis?.results,
    status: latestAnalysis?.status,
  });

  if (isLoading || error || !latestAnalysis) {
    return null;
  }

  // Only show if analysis is completed AND has results
  if (latestAnalysis.status !== "completed" || !latestAnalysis.results) {
    return null;
  }

  const { team_avg_winrate, enemy_avg_winrate, matches_analyzed } =
    latestAnalysis.results;

  // Calculate the difference to show if matchmaking was fair
  const winrateDiff = team_avg_winrate - enemy_avg_winrate;
  const winrateDiffPercent = Math.abs(winrateDiff * 100).toFixed(1);
  const isFavorable = winrateDiff > 0.05;
  const isUnfavorable = winrateDiff < -0.05;
  const isFair = !isFavorable && !isUnfavorable;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            Recent Analysis Results
          </CardTitle>
          <span className="text-sm text-muted-foreground">
            {formatDateTime(latestAnalysis.created_at)}
          </span>
        </div>
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
                  Your Team
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
                  Enemy Team
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
            Based on {matches_analyzed} ranked matches
          </p>

          {isFavorable && (
            <p className="text-sm text-green-600 dark:text-green-400">
              ✓ Your teammates had higher average winrates than enemies by{" "}
              <span className="font-bold">{winrateDiffPercent}%</span>
            </p>
          )}
          {isUnfavorable && (
            <p className="text-sm text-red-600 dark:text-red-400">
              ✗ Your enemies had higher average winrates than teammates by{" "}
              <span className="font-bold">{winrateDiffPercent}%</span>
            </p>
          )}
          {isFair && (
            <p className="text-sm text-muted-foreground">
              ≈ Matchmaking appears balanced (winrates within 5%)
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
