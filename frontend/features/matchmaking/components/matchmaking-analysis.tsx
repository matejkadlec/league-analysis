"use client";

import type { ReactNode } from "react";
import { ApiRequestError } from "@/lib/core/api";
import { useQuery } from "@tanstack/react-query";

import { getLatestMatchmakingAnalysis } from "../matchmaking-api";

import { MatchmakingAnalysisLoadingCard } from "./matchmaking-analysis-start-card";
import { MatchmakingAnalysisSession } from "./matchmaking-analysis-session";

interface MatchmakingAnalysisProps {
  puuid: string;
  analyzedPlayerLabel: string;
  playerSelector: ReactNode;
}

export function MatchmakingAnalysis({
  puuid,
  analyzedPlayerLabel,
  playerSelector,
}: MatchmakingAnalysisProps) {
  const {
    data: latestAnalysis,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["matchmaking-analysis", puuid],
    queryFn: async () => {
      const result = await getLatestMatchmakingAnalysis(puuid);
      if (!result.success) {
        // A player who has never been analysed is an ordinary empty state,
        // not a failure the card should report as an error. Every other
        // failure must throw so the shared query handler can announce it
        // and record it.
        if (result.error.status === 404) {
          return null;
        }
        throw new ApiRequestError(result.error);
      }
      return result.data;
    },
    retry: false,
    staleTime: 1000,
  });

  if (isLoading) {
    return <MatchmakingAnalysisLoadingCard />;
  }

  return (
    <MatchmakingAnalysisSession
      key={puuid}
      puuid={puuid}
      analyzedPlayerLabel={analyzedPlayerLabel}
      playerSelector={playerSelector}
      latestAnalysis={latestAnalysis ?? null}
      refetch={refetch}
    />
  );
}
