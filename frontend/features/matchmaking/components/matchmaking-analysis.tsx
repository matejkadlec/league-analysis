"use client";

import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import { getLatestMatchmakingAnalysis } from "@/lib/core/api";

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
        if (result.error.status === 404) {
          return null;
        }
        console.warn("Failed to fetch analysis:", result.error.message);
        return null;
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
