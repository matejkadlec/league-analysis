"use client";

import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ListRestart,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";

import {
  getMatchHistoryEmptyMessage,
  MATCH_HISTORY_QUEUE_FILTERS,
  type MatchHistoryQueueFilter,
} from "../queue-catalog";
import {
  MATCH_HISTORY_PAGE_SIZES,
  type MatchHistoryPageSize,
  type MatchHistoryPaginationItem,
  type MatchHistoryRecordRange,
} from "../match-history-pagination";
import { UpdatedStamp } from "@/features/profile";
import { formatFractionAsPercent } from "@/lib/core/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface MatchHistoryHeaderProps {
  lastUpdated?: string | null | undefined;
  isUpdating: boolean;
  onUpdate: () => void;
  activeQueueFilters: MatchHistoryQueueFilter[];
  onQueueFilterSelect: (
    queueId: MatchHistoryQueueFilter,
    additive: boolean,
  ) => void;
  matchSearch: string;
  onMatchSearchChange: (value: string) => void;
  totalMatches: number;
  wins: number;
  losses: number;
  winRate: number;
}

interface MatchHistoryPaginationBarProps {
  recordRange: MatchHistoryRecordRange;
  apiTotalMatches: number;
  /**
   * The stored total is not the final one: an update run is still writing
   * matches, so a range read off it would count down from a number that keeps
   * moving.
   */
  isTotalPending: boolean;
  paginationItems: MatchHistoryPaginationItem[];
  currentPage: number;
  totalPages: number;
  isFetching: boolean;
  pageSize: MatchHistoryPageSize;
  pageSizeOpen: boolean;
  onPageChange: (page: number) => void;
  onPageSizeOpenChange: (open: boolean) => void;
  onPageSizeChange: (pageSize: MatchHistoryPageSize) => void;
}

interface MatchHistoryErrorCardProps {
  isNotFound: boolean;
  errorMessage: string;
  onRetry: () => void;
}

interface MatchHistoryEmptyAlertProps {
  hasActiveSearch: boolean;
  debouncedMatchSearch: string;
  activeQueueFilters: MatchHistoryQueueFilter[];
}

export function MatchHistoryLoadingCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListRestart className="h-5 w-5 text-primary" />
          Match History
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </CardContent>
    </Card>
  );
}

/**
 * The row that stands in for the matches an update run has not stored yet.
 *
 * A row rather than a card-wide state on purpose: replacing the list with a
 * loading panel hides matches that are already there and readable. It carries
 * `role="status"` so the wait is announced once, and its text never changes as
 * rows land in front of it, so it is not re-announced per arrival either.
 */
export function MatchHistoryLoadingRow() {
  return (
    <div
      role="status"
      data-testid="match-history-loading-row"
      className="mb-1.5 flex items-center justify-center gap-2 rounded border-2 border-t-1 border-b-1 border-amber-400/20 bg-muted/30 px-3 py-3 text-sm last:mb-0"
    >
      <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
      Loading more matches...
    </div>
  );
}

export function MatchHistoryErrorCard({
  isNotFound,
  errorMessage,
  onRetry,
}: MatchHistoryErrorCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListRestart className="h-5 w-5 text-primary" />
          Match History
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {isNotFound ? (
              <div className="space-y-2">
                <p>No matches found for this player.</p>
                <p className="text-sm text-muted-foreground">
                  This could mean the player has no ranked games, or match data
                  is not yet available.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <p>{errorMessage}</p>
                <Button
                  onClick={onRetry}
                  type="submit"
                  size="sm"
                  className="mt-2"
                >
                  Retry
                </Button>
              </div>
            )}
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}

export function MatchHistoryEmptyAlert({
  hasActiveSearch,
  debouncedMatchSearch,
  activeQueueFilters,
}: MatchHistoryEmptyAlertProps) {
  return (
    <Alert>
      <AlertCircle className="h-4 w-4" />
      <AlertDescription>
        {hasActiveSearch ? (
          <p className="font-medium">
            No matches found for &quot;{debouncedMatchSearch}&quot;.
          </p>
        ) : (
          <p className="font-medium">
            {getMatchHistoryEmptyMessage(activeQueueFilters)}
          </p>
        )}
      </AlertDescription>
    </Alert>
  );
}

export function MatchHistoryHeader({
  lastUpdated,
  isUpdating,
  onUpdate,
  activeQueueFilters,
  onQueueFilterSelect,
  matchSearch,
  onMatchSearchChange,
  totalMatches,
  wins,
  losses,
  winRate,
}: MatchHistoryHeaderProps) {
  return (
    <CardHeader>
      <div className="grid grid-cols-[1fr_auto] items-center gap-3 xl:grid-cols-[1fr_auto_1fr]">
        <div className="justify-self-start">
          <CardTitle className="flex items-center gap-2">
            <ListRestart className="h-5 w-5 text-primary" />
            Match History
          </CardTitle>
        </div>

        <div
          className="order-3 col-span-2 min-w-0 w-full xl:order-none xl:col-span-1 xl:justify-self-center xl:overflow-x-auto"
          data-testid="match-history-queue-filters"
          aria-describedby="match-history-queue-instructions"
        >
          <p id="match-history-queue-instructions" className="sr-only">
            Select one queue, or hold Shift while selecting to combine queues.
          </p>
          {/*
            Below xl the strip wraps onto as many lines as the column allows;
            the seven options measure ~770px together, which no phone column
            can hold without a swipe. The per-option `widthClass` stays either
            way — it is what stops the strip shifting when the selected label
            goes bold — and `w-max min-w-full` is xl-only because that is where
            it centres a single line instead of forcing one.
          */}
          <div className="flex flex-wrap items-center justify-center gap-y-1 text-sm xl:w-max xl:min-w-full xl:flex-nowrap xl:gap-y-0">
            {MATCH_HISTORY_QUEUE_FILTERS.map((queueOption, index) => {
              const isSelected = activeQueueFilters.includes(queueOption.id);

              return (
                <div key={queueOption.id} className="flex items-center">
                  <button
                    type="button"
                    onClick={(event) =>
                      onQueueFilterSelect(queueOption.id, event.shiftKey)
                    }
                    aria-pressed={isSelected}
                    aria-describedby="match-history-queue-instructions"
                    className={`${queueOption.widthClass} text-center transition-colors ${
                      isSelected
                        ? "font-semibold text-foreground"
                        : "text-[#aaa]"
                    }`}
                  >
                    {queueOption.label}
                  </button>
                  {index < MATCH_HISTORY_QUEUE_FILTERS.length - 1 && (
                    // Only on the single-line layout. Nothing can tell CSS
                    // which option a wrapped line ends on, so below xl the
                    // separators would leave a trailing bar hanging off the
                    // end of most lines.
                    <span className="hidden text-muted-foreground xl:inline">
                      |
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <Button
          onClick={onUpdate}
          disabled={isUpdating}
          variant="outline"
          size="sm"
          className="button-small justify-self-end"
        >
          {isUpdating ? (
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-1" />
          )}
          Update
        </Button>
      </div>

      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-[230px] max-w-full shrink-0">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1.5 h-4 w-4 text-muted-foreground"
          />
          <Input
            value={matchSearch}
            onChange={(event) => onMatchSearchChange(event.target.value)}
            placeholder="Search for champion or player"
            aria-label="Search for champion or player"
            className="h-7 w-full border-white/15 bg-white/5 pl-8 !text-xs text-white placeholder:text-white/45"
          />
        </div>
        {totalMatches > 0 && (
          <div className="shrink-0 text-sm text-right">
            {totalMatches} total matches ({wins}W / {losses}L) •{" "}
            {formatFractionAsPercent(winRate)} WR
          </div>
        )}
      </div>

      <UpdatedStamp
        lastUpdated={lastUpdated}
        className="text-xs text-muted-foreground mt-1"
      />
    </CardHeader>
  );
}

export function MatchHistoryPaginationBar({
  recordRange,
  apiTotalMatches,
  isTotalPending,
  paginationItems,
  currentPage,
  totalPages,
  isFetching,
  pageSize,
  pageSizeOpen,
  onPageChange,
  onPageSizeOpenChange,
  onPageSizeChange,
}: MatchHistoryPaginationBarProps) {
  return (
    <div className="mt-3 grid items-center gap-3 border-t pt-3 text-sm text-muted-foreground md:grid-cols-[1fr_auto_1fr]">
      <div className="justify-self-start" aria-live="polite">
        {isTotalPending ? (
          // Not a range with a moving denominator: while the run is storing
          // matches every one of those three numbers is provisional, and a
          // total that keeps climbing reads as a bug rather than as progress.
          "Loading matches count..."
        ) : (
          <>
            Showing {recordRange.start} to {recordRange.end} of{" "}
            {apiTotalMatches} matches
          </>
        )}
      </div>

      <nav
        className="flex items-center justify-center gap-1"
        aria-label="Match history pages"
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-[22px] min-w-[22px] p-0 text-card-foreground disabled:text-muted-foreground disabled:opacity-100"
          aria-label="Previous page"
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={totalPages <= 1 || currentPage <= 1}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        {paginationItems.map((item) =>
          typeof item === "number" ? (
            <Button
              key={item}
              type="button"
              variant={item === currentPage ? "default" : "outline"}
              size="sm"
              className="h-8 min-w-8 px-2"
              aria-current={item === currentPage ? "page" : undefined}
              onClick={() => onPageChange(item)}
              disabled={isFetching && item === currentPage}
            >
              {item}
            </Button>
          ) : (
            <span key={item} className="px-1" aria-hidden="true">
              …
            </span>
          ),
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-[22px] min-w-[22px] p-0 text-card-foreground disabled:text-muted-foreground disabled:opacity-100"
          aria-label="Next page"
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={totalPages <= 1 || currentPage >= totalPages}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
      </nav>

      <div className="flex items-center gap-2 md:justify-self-end">
        <label htmlFor="match-history-page-size">Page size</label>
        <Popover open={pageSizeOpen} onOpenChange={onPageSizeOpenChange}>
          <PopoverTrigger asChild>
            <Button
              id="match-history-page-size"
              type="button"
              variant="outline"
              size="sm"
              className="h-8 w-[76px] justify-between px-3 font-normal"
              role="combobox"
              aria-expanded={pageSizeOpen}
              aria-haspopup="listbox"
              aria-controls="match-history-page-size-options"
              aria-label="Match history page size"
            >
              {pageSize}
              <ChevronDown aria-hidden="true" className="opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            id="match-history-page-size-options"
            role="listbox"
            aria-label="Match history page size"
            align="end"
            className="w-[76px] p-1"
          >
            {MATCH_HISTORY_PAGE_SIZES.map((size) => (
              <button
                key={size}
                type="button"
                role="option"
                aria-selected={size === pageSize}
                onClick={() => onPageSizeChange(size)}
                className="relative flex w-full items-center rounded-sm py-1.5 pl-2 pr-8 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
              >
                {size}
                {size === pageSize && (
                  <Check
                    aria-hidden="true"
                    className="absolute right-2 h-4 w-4"
                  />
                )}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
