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
   * Make a participant of one of these matches the current player. Passed in
   * rather than read from `usePlayerContext` so this card stays renderable
   * without the provider, and so the two cannot disagree about who is chosen.
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
    // A run that stopped early still stored whatever it got through, and the
    // poll below ends the moment the status leaves `running`. Scoped to this
    // card's own two caches: other cards decide what a failed fetch means.
    onSettled: (run) => {
      // `null` is a run whose status could not be read — a poll that gave up
      // part-way through the writing. That is the case with the most rows
      // stranded, not the one to skip.
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
    // In step with the list below. These are the header's totals, wins, losses
    // and win rate; leaving them unpolled while rows visibly arrive had the
    // header claiming "3 total matches" over a list already showing more.
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
    // Reported inline rather than by the global toast: MatchHistoryErrorCard
    // when the failure left nothing to show, MatchHistoryLoadFailedRow when
    // there are already rows worth keeping.
    meta: { silenceErrorToast: true },
    retry: (failureCount, error) =>
      normalizeApiError(error).kind === "network" ? false : failureCount < 2,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    placeholderData: (previousData) => previousData,
    staleTime: 60000,
    // While the player's own update run is storing matches, this is what makes
    // them appear: it is the only query carrying the rows and the total. 2s
    // rather than the 5s below because the list is visibly filling up.
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
  // An update run is storing this player's matches, so the stored total is not
  // the real one yet. The match half only: the Player Updater writes no
  // matches, so counting it over-promises.
  const isLoadingMoreMatches = isFetchingMatches;
  // Only after the last record there is: earlier pages are complete and must
  // not claim to be still filling. Not while the query behind it is failing
  // either -- a spinner over a poll that just errored is the wrong half.
  const isLastPage = currentPage >= Math.max(1, totalPages);
  const showLoadingRow = isLoadingMoreMatches && isLastPage && !error;
  // Gated on neither `isLoadingMoreMatches` nor `isLastPage`, unlike the
  // loading row: the outage that fails this query also drops
  // `isFetchingMatches`, and nothing else reports the failure.
  const showLoadFailedRow = !!error && !!data;

  useEffect(() => {
    // Not on an error: a failed request carries no `data`, which reads here as
    // a server total of zero and so as "the page you asked for is gone",
    // silently putting the viewer back on page 1.
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

  // Only when there is nothing to fall back to. React Query keeps cached data
  // through an error, and the 2s poll fails precisely when rows are on screen
  // -- that case renders MatchHistoryLoadFailedRow in the list instead.
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
          // Not while an update is running, and not when the list failed to
          // load: "no matches" is a verdict, and neither a run still going nor
          // a request that never answered has earned it.
          <MatchHistoryEmptyAlert
            hasActiveSearch={hasActiveSearch}
            debouncedMatchSearch={debouncedMatchSearch}
            activeQueueFilters={activeQueueFilters}
          />
        ) : (
          // Below `lg` a row reflows into stacked blocks; from `lg` up it is
          // the fixed-width desktop layout, which still has to scroll inside
          // this container. `min-w-0` because the flex chain refuses to shrink.
          <div
            data-testid="match-list"
            className="min-w-0 rounded-md border lg:overflow-x-auto"
            // A region that scrolls sideways must be reachable without a
            // mouse, and a focusable region needs a name -- but only from
            // `lg` up, the only width this container scrolls at.
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
