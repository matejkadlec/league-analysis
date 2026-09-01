"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { normalizeApiError } from "@/lib/core/http/api";
import {
  isMatchHistoryQuery,
  matchHistoryDetailedQueryOptions,
  matchHistoryStatsQueryOptions,
} from "../matches-query";
import { useDebouncedValue } from "@/lib/core/hooks/use-debounced-value";
import { LG_BREAKPOINT_QUERY, useMediaQuery } from "@/lib/core/hooks/use-media-query";
import { usePlayerSyncRun } from "@/features/players";
import { getMatchHistoryErrorMessage } from "../match-history-error";
import { Card, CardContent } from "@/components/ui/card";
import {
  DEFAULT_MATCH_HISTORY_QUEUE_SELECTION,
  getMatchHistoryQueueQuery,
  MatchHistoryQueueFilter,
  selectMatchHistoryQueue,
} from "@/lib/core/riot/queue-catalog";
import {
  DEFAULT_MATCH_HISTORY_PAGE_SIZE,
  getMatchHistoryPaginationItems,
  getMatchHistoryRecordRange,
  type MatchHistoryPageSize,
} from "../match-history-pagination";
import {
  persistMatchHistoryPageSize,
  persistMatchHistoryQueueFilters,
  readMatchHistoryPreferences,
} from "../match-history-preferences";
import {
  MatchHistoryEmptyAlert,
  MatchHistoryErrorCard,
  MatchHistoryHeader,
  MatchHistoryLoadingCard,
  MatchHistoryLoadFailedRow,
  MatchHistoryLoadingRow,
  MatchHistoryPaginationBar,
} from "./match-history-controls";
import { MatchRow } from "./match-row";

interface MatchHistoryProps {
  puuid: string;
  lastUpdated?: string | null | undefined;
  /**
   * Passed in rather than read from `usePlayerContext` so this card renders
   * without the provider, and the two cannot disagree about who is chosen.
   */
  onSelectPlayer: (puuid: string) => void;
}

const MATCH_HISTORY_SEARCH_DEBOUNCE_MS = 300;

export function MatchHistory({
  puuid,
  lastUpdated,
  onSelectPlayer,
}: MatchHistoryProps) {
  const router = useRouter();
  const isDesktopLayout = useMediaQuery(LG_BREAKPOINT_QUERY);
  const queryClient = useQueryClient();
  const { isUpdating, isFetchingMatches, startSync } = usePlayerSyncRun(puuid, {
    // Queries keyed by the PUUID are refreshed by the hook; the server
    // components behind this page need their own refresh.
    onCompleted: () => router.refresh(),
    // A run that stopped early still stored rows, and the poll below ends the
    // moment the status leaves `running`. Scoped to this card's own caches.
    onSettled: (run) => {
      // `null` is a status that could not be read -- the case with the most
      // rows stranded, so it must not be the one skipped.
      if (run?.status === "completed") {
        return;
      }
      void queryClient.refetchQueries({
        predicate: (query) => isMatchHistoryQuery(query.queryKey, puuid),
        type: "active",
      });
    },
  });

  const [activeQueueFilters, setActiveQueueFilters] = useState<
    MatchHistoryQueueFilter[]
  >([...DEFAULT_MATCH_HISTORY_QUEUE_SELECTION]);
  const [matchSearch, setMatchSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<MatchHistoryPageSize>(
    DEFAULT_MATCH_HISTORY_PAGE_SIZE,
  );
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [pageSizeOpen, setPageSizeOpen] = useState(false);
  const queueQueryParam = getMatchHistoryQueueQuery(activeQueueFilters);
  const normalizedMatchSearch = matchSearch.trim();
  const debouncedMatchSearch = useDebouncedValue(
    normalizedMatchSearch,
    MATCH_HISTORY_SEARCH_DEBOUNCE_MS,
  );

  /* oxlint-disable react/set-state-in-effect -- Optional browser preferences initialize after hydration to preserve a stable server snapshot. */
  useEffect(() => {
    const preferences = readMatchHistoryPreferences();
    setActiveQueueFilters(preferences.queueFilters);
    setPageSize(preferences.pageSize);
    setPreferencesReady(true);
  }, []);
  /* oxlint-enable react/set-state-in-effect */

  const { data: stats = null } = useQuery({
    ...matchHistoryStatsQueryOptions(puuid, queueQueryParam),
    enabled: !!puuid && preferencesReady,
    // Not silenced: MatchHistoryErrorCard renders off the detailed query, so a
    // stats-only failure would otherwise show 0W/0L with nothing said.
    meta: { errorTitle: "Match statistics" },
    // In step with the list below: unpolled, the header claims "3 total
    // matches" over a list already showing more.
    refetchInterval: isFetchingMatches ? 2000 : false,
  });

  const {
    data = null,
    isLoading,
    error,
    isFetching,
    isPlaceholderData,
    refetch,
  } = useQuery({
    ...matchHistoryDetailedQueryOptions({
      puuid,
      queueQueryParam,
      search: debouncedMatchSearch,
      page: currentPage,
      pageSize,
    }),
    enabled: !!puuid && preferencesReady,
    // Reported inline instead: MatchHistoryErrorCard when nothing is left to
    // show, MatchHistoryLoadFailedRow when rows are worth keeping.
    meta: { silenceErrorToast: true },
    retry: (failureCount, error) =>
      normalizeApiError(error).kind === "network" ? false : failureCount < 2,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    placeholderData: (previousData) => previousData,
    staleTime: 60000,
    // The only query carrying the rows and the total, so this is what makes a
    // run's matches appear; 2s because the list is visibly filling up.
    refetchInterval: (query) =>
      isFetchingMatches
        ? 2000
        : query.state.data?.matches.length === 0
          ? 5000
          : false,
  });

  const handleQueueFilterSelect = (
    queueId: MatchHistoryQueueFilter,
    additive: boolean,
  ) => {
    const selection = selectMatchHistoryQueue(
      activeQueueFilters,
      queueId,
      additive,
    );
    if (!selection) {
      return;
    }

    setActiveQueueFilters(selection);
    persistMatchHistoryQueueFilters(selection);
    setCurrentPage(1);
  };

  const handleMatchSearchChange = (value: string) => {
    setMatchSearch(value.slice(0, 64));
    setCurrentPage(1);
  };

  const handlePageSizeChange = (nextPageSize: MatchHistoryPageSize) => {
    setPageSize(nextPageSize);
    persistMatchHistoryPageSize(nextPageSize);
    setCurrentPage(1);
    setPageSizeOpen(false);
  };

  const matches = data?.matches || [];
  const apiTotalMatches = data?.total || 0;
  const totalMatches = stats?.total_matches ?? apiTotalMatches;
  const wins = stats?.wins ?? 0;
  const losses = stats?.losses ?? 0;
  const winRate = stats?.win_rate ?? 0;
  const totalPages = Math.ceil(apiTotalMatches / pageSize);
  const paginationItems = getMatchHistoryPaginationItems(
    currentPage,
    totalPages,
  );
  const recordRange = getMatchHistoryRecordRange(
    currentPage,
    pageSize,
    apiTotalMatches,
  );
  const hasActiveSearch = debouncedMatchSearch.length > 0;
  // The match half only: the Player Updater writes no matches, so counting it
  // would over-promise a total still being stored.
  const isLoadingMoreMatches = isFetchingMatches;
  // Earlier pages are complete and must not claim to be still filling, and a
  // spinner over a poll that just errored is the wrong half.
  const isLastPage = currentPage >= Math.max(1, totalPages);
  const showLoadingRow = isLoadingMoreMatches && isLastPage && !error;
  // Ungated, unlike the loading row: the outage that fails this query also
  // drops `isFetchingMatches`, and nothing else reports the failure.
  const showLoadFailedRow = !!error && !!data;

  useEffect(() => {
    // Not on an error: a failed request carries no `data`, which reads as a
    // server total of zero and silently sends the viewer back to page 1.
    if (isPlaceholderData || error) {
      return;
    }
    const lastAvailablePage = Math.max(1, totalPages);
    if (currentPage > lastAvailablePage) {
      // oxlint-disable-next-line react/set-state-in-effect -- The server total is authoritative when refreshed data removes the requested page.
      setCurrentPage(lastAvailablePage);
    }
  }, [currentPage, error, isPlaceholderData, totalPages]);

  if (!preferencesReady || isLoading) {
    return <MatchHistoryLoadingCard />;
  }

  // Only with nothing to fall back to: the 2s poll fails precisely when rows
  // are on screen, and that case renders MatchHistoryLoadFailedRow instead.
  if (!isFetching && error && !data) {
    const apiError = normalizeApiError(error);

    return (
      <MatchHistoryErrorCard
        isNotFound={apiError.kind === "not-found"}
        errorMessage={getMatchHistoryErrorMessage(apiError)}
        onRetry={() => void refetch()}
      />
    );
  }

  return (
    <Card id="match-history">
      <MatchHistoryHeader
        lastUpdated={lastUpdated}
        isUpdating={isUpdating}
        onUpdate={startSync}
        activeQueueFilters={activeQueueFilters}
        onQueueFilterSelect={handleQueueFilterSelect}
        matchSearch={matchSearch}
        onMatchSearchChange={handleMatchSearchChange}
        totalMatches={totalMatches}
        wins={wins}
        losses={losses}
        winRate={winRate}
      />
      <CardContent>
        {matches.length === 0 && !showLoadingRow && !showLoadFailedRow ? (
          // "No matches" is a verdict that neither a running update nor a
          // request that never answered has earned.
          <MatchHistoryEmptyAlert
            hasActiveSearch={hasActiveSearch}
            debouncedMatchSearch={debouncedMatchSearch}
            activeQueueFilters={activeQueueFilters}
          />
        ) : (
          // From `lg` up the fixed-width desktop layout must scroll inside
          // this container; `min-w-0` or the flex chain refuses to shrink.
          <div
            data-testid="match-list"
            className="min-w-0 rounded-md border lg:overflow-x-auto"
            // A sideways-scrolling region must be keyboard-reachable and
            // named, but only from `lg` up -- the only width it scrolls at.
            {...(isDesktopLayout
              ? {
                  role: "region",
                  "aria-label": "Match list",
                  tabIndex: 0,
                }
              : {})}
          >
            <div className="lg:w-max lg:min-w-full">
              {matches.map((match) => (
                <MatchRow
                  key={match.match_id}
                  match={match}
                  playerPuuid={puuid}
                  onSelectPlayer={onSelectPlayer}
                />
              ))}
              {showLoadingRow && <MatchHistoryLoadingRow />}
              {showLoadFailedRow && (
                <MatchHistoryLoadFailedRow onRetry={() => void refetch()} />
              )}
            </div>
          </div>
        )}

        <MatchHistoryPaginationBar
          recordRange={recordRange}
          apiTotalMatches={apiTotalMatches}
          isTotalPending={isLoadingMoreMatches}
          paginationItems={paginationItems}
          currentPage={currentPage}
          totalPages={totalPages}
          isFetching={isFetching}
          pageSize={pageSize}
          pageSizeOpen={pageSizeOpen}
          onPageChange={setCurrentPage}
          onPageSizeOpenChange={setPageSizeOpen}
          onPageSizeChange={handlePageSizeChange}
        />
      </CardContent>
    </Card>
  );
}
