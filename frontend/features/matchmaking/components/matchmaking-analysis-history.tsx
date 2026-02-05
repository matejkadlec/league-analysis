"use client";

import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";

import { getMatchmakingAnalysisHistory } from "@/lib/core/api";

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
}

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
}: MatchmakingAnalysisHistoryProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["matchmaking-analysis-history", puuid],
    queryFn: async () => {
      const result = await getMatchmakingAnalysisHistory(puuid, 20);
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

  if (isLoading || error || !data || data.items.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="h-5 w-5 text-primary" />
          Analysis History
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border/50">
                <TableHead className="w-[25%] text-left">Date & Time</TableHead>
                <TableHead className="w-[30%] text-left">
                  Your Team WR
                </TableHead>
                <TableHead className="w-[30%] text-left">
                  Enemy Team WR
                </TableHead>
                <TableHead className="w-[15%] text-left">Gap</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((item, index) => {
                const teamWr = item.team_avg_winrate * 100;
                const enemyWr = item.enemy_avg_winrate * 100;
                const gap = item.gap * 100;
                const isTeamHigher = gap > 0;
                const isEnemyHigher = gap < 0;

                return (
                  <TableRow
                    key={index}
                    className="border-b border-border/30 hover:bg-muted/50"
                  >
                    <TableCell className="text-left text-sm">
                      {formatDateTime(item.created_at)}
                    </TableCell>
                    <TableCell className="text-left">
                      <span
                        className={
                          isTeamHigher
                            ? "text-green-600 dark:text-green-400"
                            : isEnemyHigher
                              ? "text-red-600 dark:text-red-400"
                              : ""
                        }
                      >
                        {teamWr.toFixed(1)}%
                      </span>
                    </TableCell>
                    <TableCell className="text-left">
                      <span
                        className={
                          isEnemyHigher
                            ? "text-green-600 dark:text-green-400"
                            : isTeamHigher
                              ? "text-red-600 dark:text-red-400"
                              : ""
                        }
                      >
                        {enemyWr.toFixed(1)}%
                      </span>
                    </TableCell>
                    <TableCell className="text-left">
                      <span
                        className={
                          isTeamHigher
                            ? "text-green-600 dark:text-green-400"
                            : isEnemyHigher
                              ? "text-red-600 dark:text-red-400"
                              : ""
                        }
                      >
                        {Math.abs(gap).toFixed(1)}%
                      </span>
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
