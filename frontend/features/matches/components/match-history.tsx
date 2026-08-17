"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import {
  MatchListWithPlayerDataResponseSchema,
  MatchStatsResponseSchema,
} from "@/lib/core/schemas";
import { normalizeApiError, unwrap, validatedGet } from "@/lib/core/api";
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
  MatchHistoryPaginationBar,
} from "./match-history-controls";
import { MatchRow } from "./match-row";

interface MatchHistoryProps {
  puuid: string;
  lastUpdated?: string | null | undefined;
}

const MATCH_HISTORY_SEARCH_DEBOUNCE_MS = 300;

export function MatchHistory({ puuid, lastUpdated }: MatchHistoryProps) {
  const router = useRouter();
  const { isUpdating, startSync } = usePlayerSyncRun(puuid, {
    // Queries keyed by the PUUID are refreshed by the hook; the server
    // components behind this page need their own refresh.
    onCompleted: () => router.refresh(),
  });

  const [activeQueueFilters, setActiveQueueFilters] = useState<
    MatchHistoryQueueFilter[]
  >([...DEFAULT_MATCH_HISTORY_QUEUE_SELECTION]);
  const [matchSearch, setMatchSearch] = useState("");
  const [debouncedMatchSearch, setDebouncedMatchSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<MatchHistoryPageSize>(
    DEFAULT_MATCH_HISTORY_PAGE_SIZE,
  );
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [pageSizeOpen, setPageSizeOpen] = useState(false);
  const queueQueryParam = getMatchHistoryQueueQuery(activeQueueFilters);
  const normalizedMatchSearch = matchSearch.trim();

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedMatchSearch(normalizedMatchSearch);
    }, MATCH_HISTORY_SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [normalizedMatchSearch]);

  /* eslint-disable react-hooks/set-state-in-effect -- Optional browser preferences initialize after hydration to preserve a stable server snapshot. */
  useEffect(() => {
    const preferences = readMatchHistoryPreferences();
    setActiveQueueFilters(preferences.queueFilters);
    setPageSize(preferences.pageSize);
    setPreferencesReady(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const { data: stats = null } = useQuery({
    queryKey: ["match-history-stats", puuid, queueQueryParam],
    queryFn: async () =>
      unwrap(
        await validatedGet(
          MatchStatsResponseSchema,
          `/matches/player/${puuid}/stats`,
          { queues: queueQueryParam },
        ),
      ),
    enabled: !!puuid && preferencesReady,
    // Not silenced: MatchHistoryErrorCard renders off the detailed query, so a
    // stats-only failure would otherwise show 0W/0L with nothing said.
    meta: { errorTitle: "Match statistics" },
  });

  const {
    data = null,
    isLoading,
    error,
    isFetching,
    isPlaceholderData,
    refetch,
  } = useQuery({
    queryKey: [
      "matchHistoryDetailed",
      puuid,
      queueQueryParam,
      debouncedMatchSearch,
      currentPage,
      pageSize,
    ],
    queryFn: async () =>
      unwrap(
        await validatedGet(
          MatchListWithPlayerDataResponseSchema,
          `/matches/player/${puuid}/detailed`,
          {
            queues: queueQueryParam,
            search: debouncedMatchSearch || undefined,
            start: (currentPage - 1) * pageSize,
            count: pageSize,
          },
        ),
      ),
    enabled: !!puuid && preferencesReady,
    // MatchHistoryErrorCard below reports this failure inline.
    meta: { silenceErrorToast: true },
    retry: (failureCount, error) =>
      normalizeApiError(error).kind === "network" ? false : failureCount < 2,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    placeholderData: (previousData) => previousData,
    staleTime: 60000,
    refetchInterval: (query) =>
      query.state.data?.matches?.length === 0 ? 5000 : false,
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

  useEffect(() => {
    if (isPlaceholderData) {
      return;
    }
    const lastAvailablePage = Math.max(1, totalPages);
    if (currentPage > lastAvailablePage) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- The server total is authoritative when refreshed data removes the requested page.
      setCurrentPage(lastAvailablePage);
    }
  }, [currentPage, isPlaceholderData, totalPages]);

  if (!preferencesReady || isLoading) {
    return <MatchHistoryLoadingCard />;
  }

  if (!isFetching && error) {
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
        onUpdate={() => startSync()}
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
        {matches.length === 0 ? (
          <MatchHistoryEmptyAlert
            hasActiveSearch={hasActiveSearch}
            debouncedMatchSearch={debouncedMatchSearch}
            activeQueueFilters={activeQueueFilters}
          />
        ) : (
          // A match row lays out at desktop width and its inner blocks are
          // fixed-width by design, so on a phone it has to scroll inside this
          // container. Without `min-w-0` the flex chain above it refuses to
          // shrink and the row stretches the whole document instead.
          <div className="min-w-0 overflow-x-auto rounded-md border">
            <div className="w-max min-w-full">
              {matches.map((match) => (
                <MatchRow
                  key={match.match_id}
                  match={match}
                  playerPuuid={puuid}
                />
              ))}
            </div>
          </div>
        )}

        <MatchHistoryPaginationBar
          recordRange={recordRange}
          apiTotalMatches={apiTotalMatches}
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
