"use client";

import { useId, useState } from "react";
import { unwrap, unwrapOr404 } from "@/lib/core/http/api";
import { AnalyzedPlayerResultLabel } from "./analyzed-player-result-label";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, History, X } from "lucide-react";
import { formatDateTime, formatFractionAsPercent } from "@/lib/core/format";
import { useToast } from "@/lib/core/hooks";
import { cn } from "@/lib/core/utils";

import {
  getMatchmakingAnalysisHistory,
  deleteMatchmakingAnalysisRecord,
} from "../matchmaking-api";

import type { MatchmakingAnalysisHistoryItem } from "@/lib/core/schemas";
import { Badge } from "@/components/ui/badge";
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
import {
  persistMatchmakingHistoryOpen,
  readMatchmakingHistoryOpen,
} from "../history-open-preference";
import { formatRunType } from "../run-type";
import { GapFigure } from "./gap-figure";
import { useShownMatchmakingAnalysis } from "./use-shown-matchmaking-analysis";

interface MatchmakingAnalysisHistoryProps {
  puuid: string;
  analyzedPlayerLabel: string;
  /** An explicit pick out of this list; null while the result cards show the
      latest completed run on their own. */
  selectedCreatedAt: string | null;
  onSelect: (createdAt: string | null) => void;
}

const HISTORY_FETCH_LIMIT = 100;

/**
 * The three figures a history row shows. Both layouts read this, so the stacked
 * blocks cannot drift from the table. The win rates are plain numbers and only
 * the gap carries a verdict, read the same way as on the result cards.
 */
function historyFigures(item: MatchmakingAnalysisHistoryItem) {
  return [
    {
      label: "Ally Team WR",
      value: formatFractionAsPercent(item.team_avg_winrate),
    },
    {
      label: "Enemy Team WR",
      value: formatFractionAsPercent(item.enemy_avg_winrate),
    },
    { label: "Win Rates Gap", value: <GapFigure gap={item.gap} /> },
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
      title="Show this analysis in the result cards"
    >
      {formatDateTime(createdAt)}
    </button>
  );
}

/** Names the row the result cards are showing, in words as well as colour. */
function ShownBadge() {
  return (
    <Badge variant="outline" className="border-primary/60 text-primary">
      Shown
    </Badge>
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
        <div className="flex items-center gap-2">
          <SelectAnalysisButton
            createdAt={item.created_at}
            isSelected={isSelected}
            onSelect={onSelect}
          />
          {isSelected && <ShownBadge />}
        </div>
        <DeleteAnalysisButton createdAt={item.created_at} onDelete={onDelete} />
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
            <dd className="tabular-nums text-sm">{figure.value}</dd>
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
  // Read on first render rather than after it: the page renders only once the
  // client session probe answers, so there is no server markup to disagree
  // with, and a history that opened a frame late would shift the flowchart.
  const [isOpen, setIsOpen] = useState(readMatchmakingHistoryOpen);
  const contentId = useId();

  // Highlight what the result cards are showing, not only what was clicked here.
  // Landing on a player displays their latest completed run without any pick,
  // and an unmarked history then hides which row that run is.
  const { data: shownAnalysis } = useShownMatchmakingAnalysis(
    puuid,
    selectedCreatedAt,
  );
  const shownCreatedAt = selectedCreatedAt ?? shownAnalysis?.created_at ?? null;

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
      // The result cards read the selected run by timestamp. Leaving the
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

  const toggle = () => {
    const next = !isOpen;
    setIsOpen(next);
    persistMatchmakingHistoryOpen(next);
  };
  const items = data?.items ?? [];
  const placeholder = isLoading
    ? "Loading analysis history..."
    : error
      ? "Analysis history could not be loaded."
      : items.length === 0
        ? "No completed analyses are available for this player yet."
        : null;

  // A disclosure under the result cards (LGA-135): one heading-wrapped button,
  // closed by default, so the history is there for comparing runs without
  // taking the page from the result it was picked for.
  return (
    <Card id="matchmaking-analysis-history">
      <CardHeader>
        <CardTitle>
          <button
            type="button"
            onClick={toggle}
            aria-expanded={isOpen}
            aria-controls={isOpen ? contentId : undefined}
            className="flex w-full cursor-pointer items-center gap-2 text-left"
          >
            <History className="h-5 w-5 text-primary" />
            Analysis History
            {data && (
              <span className="font-normal text-muted-foreground">
                ({items.length})
              </span>
            )}
            <ChevronDown
              aria-hidden="true"
              className={cn(
                "ml-auto h-5 w-5 text-muted-foreground transition-transform duration-300",
                isOpen && "rotate-180",
              )}
            />
          </button>
        </CardTitle>
        <AnalyzedPlayerResultLabel playerLabel={analyzedPlayerLabel} />
      </CardHeader>
      {isOpen && (
        <CardContent id={contentId}>
          {placeholder ? (
            <p className="text-sm text-muted-foreground">{placeholder}</p>
          ) : (
            <HistoryList
              items={items}
              deletingIds={deletingIds}
              shownCreatedAt={shownCreatedAt}
              onDelete={handleDelete}
              onSelect={onSelect}
            />
          )}
        </CardContent>
      )}
    </Card>
  );
}

/**
 * Every run, stacked on a phone and as a table from `sm`. Both scroll inside
 * one bounded region: the history is paged to `HISTORY_FETCH_LIMIT` runs, and
 * left uncapped it would push the flowchart a hundred rows down the page.
 */
function HistoryList({
  items,
  deletingIds,
  shownCreatedAt,
  onDelete,
  onSelect,
}: {
  items: MatchmakingAnalysisHistoryItem[];
  deletingIds: Set<string>;
  shownCreatedAt: string | null;
  onDelete: (createdAt: string) => void;
  onSelect: (createdAt: string) => void;
}) {
  return (
    <div
      className="max-h-[490px] overflow-y-auto"
      // Scrollable once history outgrows max-h; without a focus stop its
      // content is unreachable by keyboard. The axe gate cannot see this:
      // its fixture serves five rows, which fit without scrolling.
      role="region"
      aria-label="Analysis history"
      tabIndex={0}
    >
      {/* Tailwind's reset removes the list marker, and WebKit then drops the
            list role — which would leave this labelled group unannounced.
            `role="list"` puts the semantics back. */}
      <ul
        role="list"
        aria-label="Analysis history"
        data-testid="matchmaking-analysis-history-stacked"
        className="space-y-3 sm:hidden"
      >
        {items.map((item) => (
          <AnalysisBlock
            key={item.created_at}
            item={item}
            isDeleting={deletingIds.has(item.created_at)}
            isSelected={item.created_at === shownCreatedAt}
            onDelete={onDelete}
            onSelect={onSelect}
          />
        ))}
      </ul>

      <div className="hidden overflow-x-auto sm:block">
        <Table>
          <TableHeader>
            <TableRow className="h-11 border-b border-border/50">
              <TableHead className="min-w-[140px] text-left">
                Date & Time
              </TableHead>
              <TableHead className="min-w-[90px] text-left">Type</TableHead>
              <TableHead className="w-[19%] text-right">Ally Team WR</TableHead>
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
            {items.map((item) => {
              const isDeleting = deletingIds.has(item.created_at);
              const isSelected = item.created_at === shownCreatedAt;

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
                    <div className="flex items-center gap-2">
                      <SelectAnalysisButton
                        createdAt={item.created_at}
                        isSelected={isSelected}
                        onSelect={onSelect}
                      />
                      {isSelected && <ShownBadge />}
                    </div>
                  </TableCell>
                  <TableCell className="text-left text-sm text-muted-foreground">
                    {formatRunType(item.params)}
                  </TableCell>
                  {historyFigures(item).map((figure) => (
                    <TableCell
                      key={figure.label}
                      className="text-right tabular-nums"
                    >
                      {figure.value}
                    </TableCell>
                  ))}
                  <TableCell className="text-center p-0">
                    <DeleteAnalysisButton
                      createdAt={item.created_at}
                      onDelete={onDelete}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
