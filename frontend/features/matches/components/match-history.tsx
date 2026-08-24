"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { normalizeApiError } from "@/lib/core/api";
import {
  isMatchHistoryQuery,
  matchHistoryDetailedQueryOptions,
  matchHistoryStatsQueryOptions,
} from "../matches-query";
import { useDebouncedValue } from "@/lib/core/use-debounced-value";
import { LG_BREAKPOINT_QUERY, useMediaQuery } from "@/lib/core/use-media-query";
import { usePlayerSyncRun } from "@/features/players";
import { getMatchHistoryErrorMessage } from "../utils/match-history-error";
import { Card, CardContent } from "@/components/ui/card";
import {
  DEFAULT_MATCH_HISTORY_QUEUE_SELECTION,
  getMatchHistoryQueueQuery,
  MatchHistoryQueueFilter,
  selectMatchHistoryQueue,
} from "../queue-catalog";
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
   * Make a participant of one of these matches the current player.
   *
   * Passed in rather than read from `usePlayerContext` here so this card stays
   * renderable without the provider — the page above already holds the
   * context, and taking it twice would only add a second place for the two to
   * disagree about who is selected.
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
    // A run that stopped early still stored whatever it got through before it
    // stopped, and the poll below ends the moment the status leaves `running`
    // — so rows written since its last tick would stay invisible until
    // something else happened to refetch. The hook refreshes on a completed
    // run only. Scoped to this card's own two caches rather than everything
    // keyed by the PUUID: other cards decide for themselves what a failed
    // fetch means for what they show. Smurf Boost reports the failure itself
    // but deliberately quotes no games-added count for it, and refreshing its
    // stored-game count from here is what would put a number back.
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

  /* eslint-disable react-hooks/set-state-in-effect -- Optional browser preferences initialize after hydration to preserve a stable server snapshot. */
  useEffect(() => {
    const preferences = readMatchHistoryPreferences();
    setActiveQueueFilters(preferences.queueFilters);
    setPageSize(preferences.pageSize);
    setPreferencesReady(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

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
    // them appear: it is the only query that carries the rows themselves and
    // the total the pagination is built from, and the run writes rows the whole
    // time it is going. 2s rather than the 5s
    // below because the empty-history case is waiting for a first row to exist
    // at all, while this one is a list visibly filling up.
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
  // the real one yet and neither is the last page. Everything progressive about
  // this card hangs off exactly this: the run is authoritative about whether
  // more records are still coming, and `usePlayerSyncRun` reports it whoever
  // started it — the Update button here, or the switch that brought us to this
  // player. The match half only: the Player Updater that follows it writes no
  // matches, so counting it would keep promising rows that are not coming.
  const isLoadingMoreMatches = isFetchingMatches;
  // Only after the last record there is. Earlier pages are complete and must
  // not claim to be still filling; page 1 carries it while nothing is stored
  // yet, which is the case where it is the only row in the list.
  // Not while the query behind it is failing: a spinner saying more rows are
  // on the way, over a poll that just errored, is the wrong half of the story.
  const isLastPage = currentPage >= Math.max(1, totalPages);
  const showLoadingRow = isLoadingMoreMatches && isLastPage && !error;
  // Gated on neither `isLoadingMoreMatches` nor `isLastPage`, unlike the
  // loading row. The outage that fails this query also fails the sync poll,
  // which drops `isFetchingMatches` to false, so hanging this off it would
  // hide the row exactly when it is needed. A failed page change is the other
  // way in: placeholder data keeps the previous page's rows up while the
  // pagination bar points at the new one, and this query is opted out of the
  // global error toast, so without this row nothing at all reports it. The
  // last-page rule belongs to the loading row, which claims progress — "this
  // failed, retry" is true on any page.
  const showLoadFailedRow = !!error && !!data;

  useEffect(() => {
    // Not on an error. A failed request carries no `data`, which reads here as
    // a server total of zero and so as "the page you asked for is gone" -- so
    // a page change whose fetch failed silently put the viewer back on page 1,
    // with the error card suppressed by the fallback rows and this query opted
    // out of the global toast. An error is not a statement about the total.
    if (isPlaceholderData || error) {
      return;
    }
    const lastAvailablePage = Math.max(1, totalPages);
    if (currentPage > lastAvailablePage) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- The server total is authoritative when refreshed data removes the requested page.
      setCurrentPage(lastAvailablePage);
    }
  }, [currentPage, error, isPlaceholderData, totalPages]);

  if (!preferencesReady || isLoading) {
    return <MatchHistoryLoadingCard />;
  }

  // Only when there is nothing to fall back to. React Query keeps cached data
  // through an error, and the 2s poll this card runs while rows are arriving
  // fails precisely when there are rows on screen — a card-wide error there
  // would throw away readable matches over one bad request. That case renders
  // MatchHistoryLoadFailedRow in the list instead.
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
          // a request that never answered has earned it. The list below
          // renders with that row as its only body row instead.
          <MatchHistoryEmptyAlert
            hasActiveSearch={hasActiveSearch}
            debouncedMatchSearch={debouncedMatchSearch}
            activeQueueFilters={activeQueueFilters}
          />
        ) : (
          // Below `lg` a row reflows into stacked blocks and fits any phone.
          // From `lg` up it is the fixed-width desktop layout, which wants
          // ~1280px and so still has to scroll inside this container on the
          // laptop widths that do not have it. `min-w-0` because the flex
          // chain above refuses to shrink otherwise, and the row would
          // stretch the whole document instead of scrolling here.
          <div
            data-testid="match-list"
            className="min-w-0 rounded-md border lg:overflow-x-auto"
            // A region that scrolls sideways must be reachable without a
            // mouse, and a focusable region needs a name — but only from
            // `lg` up, because that is the only width this container
            // scrolls at. Applying them unconditionally put a keyboard stop
            // on a phone in front of a region that cannot move.
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
