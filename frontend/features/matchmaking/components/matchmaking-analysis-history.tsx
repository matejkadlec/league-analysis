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
import { formatRunType } from "../run-type";

interface MatchmakingAnalysisHistoryProps {
  puuid: string;
  analyzedPlayerLabel: string;
  selectedCreatedAt: string | null;
  onSelect: (createdAt: string | null) => void;
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
      // Both layouts nest this inside the row that selects the run. Without
      // stopping the bubble, deleting a record also displays it.
      onClick={(event) => {
        event.stopPropagation();
        onDelete(createdAt);
      }}
      className="icon-circle"
      title="Delete this analysis"
    >
      <X />
    </button>
  );
}

/**
 * The run's timestamp as the control that shows it. The surrounding row also
 * selects on click; this is what carries the affordance to a screen reader
 * and gives the keyboard a stop on every row.
 */
function SelectAnalysisButton({
  createdAt,
  isSelected,
  onSelect,
}: {
  createdAt: string;
  isSelected: boolean;
  onSelect: (createdAt: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(createdAt)}
      aria-current={isSelected ? "true" : undefined}
      className={cn(
        "cursor-pointer text-left text-sm hover:underline",
        isSelected && "font-medium text-primary",
      )}
      title="Show this analysis in the result card"
    >
      {formatDateTime(createdAt)}
    </button>
  );
}

/**
 * One analysis stacked for a narrow screen. The table's six columns need
 * ~520px before the win-rate headings wrap, and scrolling sideways would put
 * the gap -- the number the whole card exists to show -- behind a gesture.
 */
function AnalysisBlock({
  item,
  isDeleting,
  isSelected,
  onDelete,
  onSelect,
}: {
  item: MatchmakingAnalysisHistoryItem;
  isDeleting: boolean;
  isSelected: boolean;
  onDelete: (createdAt: string) => void;
  onSelect: (createdAt: string) => void;
}) {
  return (
    <li
      className={cn(
        "rounded-md border p-3 transition-all duration-300",
        isSelected
          ? "border-primary/60 bg-primary/10"
          : "border-border/60 bg-muted/20",
        isDeleting ? "opacity-0 scale-y-0" : "opacity-100 scale-y-100",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <SelectAnalysisButton
          createdAt={item.created_at}
          isSelected={isSelected}
          onSelect={onSelect}
        />
        <DeleteAnalysisButton
          createdAt={item.created_at}
          onDelete={onDelete}
        />
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {formatRunType(item.params)}
      </p>
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
  selectedCreatedAt,
  onSelect,
}: MatchmakingAnalysisHistoryProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  const { data, isLoading, error } = useQuery({
    queryKey: matchmakingHistoryQueryKey(puuid),
    queryFn: async ({ signal }) => {
      return unwrapOr404(
        await getMatchmakingAnalysisHistory(puuid, HISTORY_FETCH_LIMIT, signal),
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
    onSuccess: (createdAt) => {
      toast.success("Matchmaking analysis removed", {
        description: "The selected history record was deleted.",
      });
      // The result card reads the selected run by timestamp. Leaving the
      // deleted one selected would leave it asking for a gone record.
      if (createdAt === selectedCreatedAt) {
        onSelect(null);
      }
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
              isSelected={item.created_at === selectedCreatedAt}
              onDelete={handleDelete}
              onSelect={onSelect}
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
                <TableHead className="min-w-[90px] text-left">Type</TableHead>
                <TableHead className="w-[19%] text-right">
                  Ally Team WR
                </TableHead>
                <TableHead className="w-[19%] text-right">
                  Enemy Team WR
                </TableHead>
                <TableHead className="w-[19%] text-right">
                  Win Rates Gap
                </TableHead>
                <TableHead className="w-auto min-w-[40px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((item) => {
                const isDeleting = deletingIds.has(item.created_at);
                const isSelected = item.created_at === selectedCreatedAt;

                return (
                  <TableRow
                    key={item.created_at}
                    // Clicking anywhere but the delete button shows the run.
                    // The date cell holds the button that says so, and the
                    // keyboard reaches the row through it.
                    onClick={() => onSelect(item.created_at)}
                    data-state={isSelected ? "selected" : undefined}
                    // Height stated per branch it applies to, so the gap closes
                    // with the animation rather than after it.
                    className={cn(
                      "cursor-pointer border-b border-border/30 hover:bg-muted/50 transition-all duration-300",
                      isDeleting
                        ? "h-0 opacity-0 scale-y-0"
                        : "h-11 opacity-100 scale-y-100",
                    )}
                  >
                    <TableCell className="text-left text-sm">
                      <SelectAnalysisButton
                        createdAt={item.created_at}
                        isSelected={isSelected}
                        onSelect={onSelect}
                      />
                    </TableCell>
                    <TableCell className="text-left text-sm text-muted-foreground">
                      {formatRunType(item.params)}
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
