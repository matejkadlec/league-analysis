"use client";

import { useState } from "react";
import { unwrap, unwrapOr404 } from "@/lib/core/api";
import { AnalyzedPlayerResultLabel } from "./analyzed-player-result-label";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { History, X } from "lucide-react";
import { formatDateTime, formatFractionAsPercent } from "@/lib/core/format";
import { useToast } from "@/lib/core/hooks";
import { cn } from "@/lib/core/utils";

import {
  getMatchmakingAnalysisHistory,
  deleteMatchmakingAnalysisRecord,
} from "../matchmaking-api";

import type { MatchmakingAnalysisHistoryItem } from "@/lib/core/schemas";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  invalidateMatchmakingRun,
  matchmakingHistoryQueryKey,
} from "../matchmaking-query";
import { gapVerdict } from "../gap-verdict";

interface MatchmakingAnalysisHistoryProps {
  puuid: string;
  analyzedPlayerLabel: string;
}

const HISTORY_FETCH_LIMIT = 100;

/**
 * The three win-rate figures a history row shows, with the colour each is
 * drawn in. Both layouts read this rather than recomputing it, so the stacked
 * blocks cannot drift from the table on which side of a gap is good news.
 */
function historyFigures(item: MatchmakingAnalysisHistoryItem) {
  // A zero threshold, so every gap is coloured: more visually pleasing here
  // than the results card's three-point fairness band, which leaves a small
  // gap grey. Both readings are deliberate; `gapVerdict` is where they differ.
  const { ally: allyColor, enemy: enemyColor } = gapVerdict(item.gap, 0);

  return [
    {
      label: "Ally Team WR",
      value: formatFractionAsPercent(item.team_avg_winrate),
      colorClass: allyColor,
    },
    {
      label: "Enemy Team WR",
      value: formatFractionAsPercent(item.enemy_avg_winrate),
      colorClass: enemyColor,
    },
    {
      label: "Win Rates Gap",
      value: formatFractionAsPercent(Math.abs(item.gap)),
      colorClass: allyColor,
    },
  ];
}

function DeleteAnalysisButton({
  createdAt,
  onDelete,
}: {
  createdAt: string;
  onDelete: (createdAt: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onDelete(createdAt)}
      className="icon-circle"
      title="Delete this analysis"
    >
      <X />
    </button>
  );
}

/**
 * One analysis stacked for a narrow screen. The table's five columns need
 * ~430px before the win-rate headings wrap, and scrolling sideways would put
 * the gap -- the number the whole card exists to show -- behind a gesture.
 */
function AnalysisBlock({
  item,
  isDeleting,
  onDelete,
}: {
  item: MatchmakingAnalysisHistoryItem;
  isDeleting: boolean;
  onDelete: (createdAt: string) => void;
}) {
  return (
    <li
      className={cn(
        "rounded-md border border-border/60 bg-muted/20 p-3 transition-all duration-300",
        isDeleting ? "opacity-0 scale-y-0" : "opacity-100 scale-y-100",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm">{formatDateTime(item.created_at)}</span>
        <DeleteAnalysisButton
          createdAt={item.created_at}
          onDelete={onDelete}
        />
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-border/40 pt-2">
        {historyFigures(item).map((figure) => (
          <div key={figure.label}>
            <dt className="text-sm uppercase tracking-wide text-muted-foreground">
              {figure.label}
            </dt>
            <dd className={cn("tabular-nums text-sm", figure.colorClass)}>
              {figure.value}
            </dd>
          </div>
        ))}
      </dl>
    </li>
  );
}

export function MatchmakingAnalysisHistory({
  puuid,
  analyzedPlayerLabel,
}: MatchmakingAnalysisHistoryProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  const { data, isLoading, error } = useQuery({
    queryKey: matchmakingHistoryQueryKey(puuid),
    queryFn: async () => {
      return unwrapOr404(
        await getMatchmakingAnalysisHistory(puuid, HISTORY_FETCH_LIMIT),
        { items: [] },
      );
    },
    retry: false,
    staleTime: 30000,
  });

  const deleteMutation = useMutation({
    mutationFn: async (createdAt: string) => {
      unwrap(await deleteMatchmakingAnalysisRecord(puuid, createdAt));
      return createdAt;
    },
    onSuccess: () => {
      toast.success("Matchmaking analysis removed", {
        description: "The selected history record was deleted.",
      });
      void invalidateMatchmakingRun(queryClient, puuid);
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
        {/* Tailwind's reset removes the list marker, and WebKit then drops the
            list role — which would leave this labelled group unannounced.
            `role="list"` puts the semantics back. */}
        <ul
          role="list"
          aria-label="Analysis history"
          data-testid="matchmaking-analysis-history-stacked"
          // No cap, unlike the table: a short scroll region nested inside a
          // scrolling page is worse to use than a page that simply runs longer.
          // The history is paged to `HISTORY_FETCH_LIMIT`, so the run is bounded.
          className="space-y-3 sm:hidden"
        >
          {data.items.map((item) => (
            <AnalysisBlock
              key={item.created_at}
              item={item}
              isDeleting={deletingIds.has(item.created_at)}
              onDelete={handleDelete}
            />
          ))}
        </ul>

        <div
          className="hidden sm:block overflow-x-auto overflow-y-auto max-h-[490px]"
          // Scrollable once history outgrows max-h; without a focus stop its
          // content is unreachable by keyboard. The axe gate cannot see this:
          // its fixture serves five rows, which fit without scrolling.
          role="region"
          aria-label="Analysis history"
          tabIndex={0}
        >
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
                const isDeleting = deletingIds.has(item.created_at);

                return (
                  <TableRow
                    key={item.created_at}
                    // Height stated per branch it applies to, so the gap closes
                    // with the animation rather than after it.
                    className={cn(
                      "border-b border-border/30 hover:bg-muted/50 transition-all duration-300",
                      isDeleting
                        ? "h-0 opacity-0 scale-y-0"
                        : "h-11 opacity-100 scale-y-100",
                    )}
                  >
                    <TableCell className="text-left text-sm">
                      {formatDateTime(item.created_at)}
                    </TableCell>
                    {historyFigures(item).map((figure) => (
                      <TableCell
                        key={figure.label}
                        className="text-right tabular-nums"
                      >
                        <span className={figure.colorClass}>
                          {figure.value}
                        </span>
                      </TableCell>
                    ))}
                    <TableCell className="text-center p-0">
                      <DeleteAnalysisButton
                        createdAt={item.created_at}
                        onDelete={handleDelete}
                      />
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
