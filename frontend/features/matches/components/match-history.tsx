"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  MatchListWithPlayerDataResponseSchema,
  MatchStatsResponseSchema,
} from "@/lib/core/schemas";
import { validatedGet } from "@/lib/core/api";
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
import { useMatchHistorySync } from "./use-match-history-sync";

interface MatchHistoryProps {
  puuid: string;
  lastUpdated?: string | null | undefined;
}

const MATCH_HISTORY_SEARCH_DEBOUNCE_MS = 300;

export function MatchHistory({ puuid, lastUpdated }: MatchHistoryProps) {
  const { isUpdating, handleUpdate } = useMatchHistorySync(puuid);

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

  const { data: statsResult } = useQuery({
    queryKey: ["match-history-stats", puuid, queueQueryParam],
    queryFn: () =>
      validatedGet(MatchStatsResponseSchema, `/matches/player/${puuid}/stats`, {
        queues: queueQueryParam,
      }),
    enabled: !!puuid && preferencesReady,
  });

  const {
    data: response,
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
    queryFn: () =>
      validatedGet(
        MatchListWithPlayerDataResponseSchema,
        `/matches/player/${puuid}/detailed`,
        {
          queues: queueQueryParam,
          search: debouncedMatchSearch || undefined,
          start: (currentPage - 1) * pageSize,
          count: pageSize,
        },
      ),
    enabled: !!puuid && preferencesReady,
    retry: (failureCount, error) => {
      if (
        error instanceof Error &&
        (error.message.includes("Network Error") ||
          error.message.includes("ERR_NETWORK"))
      ) {
        return false;
      }
      return failureCount < 2;
    },
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    placeholderData: (previousData) => previousData,
    staleTime: 60000,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (
        data?.success &&
        data.data?.matches &&
        data.data.matches.length === 0
      ) {
        return 5000;
      }
      return false;
    },
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

  const data = response?.success ? response.data : null;
  const matches = data?.matches || [];
  const apiTotalMatches = data?.total || 0;
  const stats = statsResult?.success ? statsResult.data : null;
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

  if ((!isFetching && error) || (response && !response.success)) {
    const errorMessage = getMatchHistoryErrorMessage(
      error,
      response && !response.success ? response.error : null,
    );

    const isNotFound =
      errorMessage.toLowerCase().includes("not found") ||
      (error instanceof Error && error.message.includes("404"));

    return (
      <MatchHistoryErrorCard
        isNotFound={isNotFound}
        errorMessage={errorMessage}
        onRetry={() => void refetch()}
      />
    );
  }

  return (
    <Card id="match-history">
      <MatchHistoryHeader
        lastUpdated={lastUpdated}
        isUpdating={isUpdating}
        onUpdate={() => void handleUpdate()}
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
          <div className="rounded-md border">
            {matches.map((match) => (
              <MatchRow
                key={match.match_id}
                match={match}
                playerPuuid={puuid}
              />
            ))}
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
