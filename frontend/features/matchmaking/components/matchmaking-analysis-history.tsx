"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { History, X } from "lucide-react";
import { useToast } from "@/lib/core/hooks";

import {
  getMatchmakingAnalysisHistory,
  deleteMatchmakingAnalysisRecord,
} from "@/lib/core/api";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface MatchmakingAnalysisHistoryProps {
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

const HISTORY_FETCH_LIMIT = 100;

/**
 * Format date/time as D.M.YYYY H:MM AM|PM (no leading zeros except minutes)
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
  hours = hours ? hours : 12;

  const minutesStr = minutes < 10 ? `0${minutes}` : minutes;

  return `${day}.${month}.${year} ${hours}:${minutesStr} ${ampm}`;
}

export function MatchmakingAnalysisHistory({
  puuid,
  analyzedPlayerLabel,
}: MatchmakingAnalysisHistoryProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  const { data, isLoading, error } = useQuery({
    queryKey: ["matchmaking-analysis-history", puuid],
    queryFn: async () => {
      const result = await getMatchmakingAnalysisHistory(
        puuid,
        HISTORY_FETCH_LIMIT,
      );
      if (!result.success) {
        if (result.error.status === 404) {
          return { items: [] };
        }
        throw new Error(result.error.message);
      }
      return result.data;
    },
    retry: false,
    staleTime: 30000,
  });

  const deleteMutation = useMutation({
    mutationFn: async (createdAt: string) => {
      const result = await deleteMatchmakingAnalysisRecord(puuid, createdAt);
      if (!result.success) {
        throw new Error(result.error.message);
      }
      return createdAt;
    },
    onSuccess: () => {
      toast.success("Matchmaking analysis removed", {
        description: "The selected history record was deleted.",
      });
      queryClient.invalidateQueries({
        queryKey: ["matchmaking-analysis-history", puuid],
      });
      queryClient.invalidateQueries({
        queryKey: ["matchmaking-analysis-results", puuid],
      });
    },
    onError: () => {
      toast.error("Matchmaking analysis was not removed", {
        description: "Please try again later.",
      });
    },
  });

  const handleDelete = (createdAt: string) => {
    setDeletingIds((prev) => new Set(prev).add(createdAt));
    // Wait for the fade-out animation before actually deleting
    setTimeout(() => {
      deleteMutation.mutate(createdAt);
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(createdAt);
        return next;
      });
    }, 300);
  };

  if (isLoading || error || !data || data.items.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            Analysis History
          </CardTitle>
          <AnalyzedPlayerResultLabel playerLabel={analyzedPlayerLabel} />
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {isLoading
            ? "Loading analysis history..."
            : error
              ? "Analysis history could not be loaded."
              : "No completed analyses are available for this player yet."}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="h-5 w-5 text-primary" />
          Analysis History
        </CardTitle>
        <AnalyzedPlayerResultLabel playerLabel={analyzedPlayerLabel} />
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto overflow-y-auto max-h-[490px]">
          <Table>
            <TableHeader>
              <TableRow className="h-11 border-b border-border/50">
                <TableHead className="min-w-[140px] text-left">
                  Date & Time
                </TableHead>
                <TableHead className="w-[24%] text-right">
                  Ally Team WR
                </TableHead>
                <TableHead className="w-[24%] text-right">
                  Enemy Team WR
                </TableHead>
                <TableHead className="w-[24%] text-right">
                  Win Rates Gap
                </TableHead>
                <TableHead className="w-auto min-w-[40px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((item) => {
                const teamWr = item.team_avg_winrate * 100;
                const enemyWr = item.enemy_avg_winrate * 100;
                const gap = item.gap * 100;
                // Currently set to 0 so the numbers always colored, as it's more
                // visually pleasing, might be changed to the 3% threshold in the future
                const isSignificant = Math.abs(gap) >= 0;
                const isTeamHigher = gap > 0;
                const isEnemyHigher = gap < 0;
                const isDeleting = deletingIds.has(item.created_at);

                const colorClass = !isSignificant
                  ? ""
                  : isTeamHigher
                    ? "text-green-600 dark:text-green-400"
                    : "text-red-600 dark:text-red-400";

                const inverseColorClass = !isSignificant
                  ? ""
                  : isEnemyHigher
                    ? "text-green-600 dark:text-green-400"
                    : "text-red-600 dark:text-red-400";

                return (
                  <TableRow
                    key={item.created_at}
                    className={`h-11 border-b border-border/30 hover:bg-muted/50 transition-all duration-300 ${isDeleting ? "opacity-0 scale-y-0 h-0" : "opacity-100 scale-y-100"}`}
                  >
                    <TableCell className="text-left text-sm">
                      {formatDateTime(item.created_at)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className={colorClass}>{teamWr.toFixed(1)}%</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className={inverseColorClass}>
                        {enemyWr.toFixed(1)}%
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className={colorClass}>
                        {Math.abs(gap).toFixed(1)}%
                      </span>
                    </TableCell>
                    <TableCell className="text-center p-0">
                      <button
                        onClick={() => handleDelete(item.created_at)}
                        className="icon-circle"
                        title="Delete this analysis"
                      >
                        <X />
                      </button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
