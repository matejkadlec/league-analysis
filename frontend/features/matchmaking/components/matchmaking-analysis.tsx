"use client";

import type { ReactNode } from "react";
import { unwrapOr404 } from "@/lib/core/api";
import { useQuery } from "@tanstack/react-query";

import { getLatestMatchmakingAnalysis } from "../matchmaking-api";

import { MatchmakingAnalysisLoadingCard } from "./matchmaking-analysis-start-card";
import { MatchmakingAnalysisSession } from "./matchmaking-analysis-session";
import {
  matchmakingAnalysisQueryKey,
} from "../matchmaking-query";

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
  const { data: latestAnalysis, isLoading } = useQuery({
    queryKey: matchmakingAnalysisQueryKey(puuid),
    queryFn: async () => {
      return unwrapOr404(await getLatestMatchmakingAnalysis(puuid), null);
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
    />
  );
}
