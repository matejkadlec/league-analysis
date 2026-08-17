"use client";

import { useEffect, useEffectEvent, useReducer, useState } from "react";
import type { ReactNode } from "react";
import { useQuery, type QueryObserverResult } from "@tanstack/react-query";

import { getMatchmakingAnalysisStatus } from "@/lib/core/api";
import type { MatchmakingAnalysisResponse } from "@/lib/core/schemas";

import { MatchmakingAnalysisActiveCard } from "./matchmaking-analysis-active-card";
import { MatchmakingAnalysisStartCard } from "./matchmaking-analysis-start-card";
import {
  EXPECTED_PLAYERS,
  analysisFailureMessage,
  analysisUiReducer,
  initAnalysisUiState,
  isActiveAnalysisStatus,
  isSameAnalysisInstance,
  resolveDisplayPhase,
  resolveDisplayedAnimProgress,
  resolveDisplayedFailure,
  resolveWatchingCreatedAt,
} from "./matchmaking-analysis-state";
import {
  estimateMatchmakingMinutesRemaining,
  projectMatchmakingProgress,
} from "./matchmaking-progress";
import { useMatchmakingAnalysisMutations } from "./use-matchmaking-analysis-mutations";

export interface MatchmakingAnalysisSessionProps {
  puuid: string;
  analyzedPlayerLabel: string;
  playerSelector: ReactNode;
  latestAnalysis: MatchmakingAnalysisResponse | null;
  refetch: () => Promise<QueryObserverResult<MatchmakingAnalysisResponse | null>>;
}

export function MatchmakingAnalysisSession({
  puuid,
  analyzedPlayerLabel,
  playerSelector,
  latestAnalysis,
  refetch,
}: MatchmakingAnalysisSessionProps) {
  const [state, dispatch] = useReducer(
    analysisUiReducer,
    latestAnalysis,
    initAnalysisUiState,
  );
  const [nowTimestamp, setNowTimestamp] = useState(() => Date.now());

  useEffect(() => {
    const intervalId = setInterval(() => {
      setNowTimestamp(Date.now());
    }, 1000);

    return () => clearInterval(intervalId);
  }, []);

  const watchingCreatedAt = resolveWatchingCreatedAt(state, latestAnalysis);
  const { toast, queryClient, startMutation, cancelMutation } =
    useMatchmakingAnalysisMutations(puuid, watchingCreatedAt, dispatch);
  const storedWatching = state.phase === "running" || state.phase === "starting";
  const latestMatchesCurrent =
    Boolean(watchingCreatedAt) &&
    isSameAnalysisInstance(latestAnalysis?.created_at, watchingCreatedAt);
  const latestForCurrent = latestMatchesCurrent ? latestAnalysis : null;

  const { data: statusUpdate } = useQuery({
    queryKey: ["matchmaking-analysis-status", puuid, watchingCreatedAt],
    queryFn: async () => {
      if (!watchingCreatedAt) {
        return null;
      }
      const result = await getMatchmakingAnalysisStatus(puuid, watchingCreatedAt);
      if (!result.success) {
        return null;
      }
      if (
        result.data.status === "in_progress" ||
        result.data.status === "waiting_rate_limit"
      ) {
        dispatch({
          type: "observe-active-progress",
          progress: result.data.progress,
        });
      }
      dispatch({
        type: "consider-reanchor",
        analysisCreatedAt: watchingCreatedAt,
        authoritativeProgress: result.data.progress || 0,
        totalPlayers: result.data.total_puuids || EXPECTED_PLAYERS,
      });
      return result.data;
    },
    enabled:
      Boolean(watchingCreatedAt) &&
      (storedWatching ||
        (state.phase === "idle" &&
          isActiveAnalysisStatus(latestAnalysis?.status))),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (
        status === "completed" ||
        status === "failed" ||
        status === "cancelled"
      ) {
        return false;
      }
      return 3000;
    },
    staleTime: 0,
  });

  const validStatusUpdate =
    statusUpdate &&
    watchingCreatedAt &&
    isSameAnalysisInstance(statusUpdate.created_at, watchingCreatedAt)
      ? statusUpdate
      : null;
  const watchingStatus = validStatusUpdate?.status ?? latestForCurrent?.status;
  const currentStatus = storedWatching
    ? watchingStatus
    : latestAnalysis?.status;
  const shouldPoll =
    Boolean(watchingCreatedAt) &&
    currentStatus !== "completed" &&
    currentStatus !== "failed" &&
    currentStatus !== "cancelled" &&
    (storedWatching ||
      (state.phase === "idle" &&
        isActiveAnalysisStatus(latestAnalysis?.status)));
  const displayPhase = resolveDisplayPhase(
    state.phase,
    currentStatus,
    latestAnalysis?.status,
    Boolean(state.analysisFailure),
    !state.sawInProgress || state.lastBackendProgress < 10,
  );
  const animProgress = resolveDisplayedAnimProgress(
    displayPhase,
    state.animProgress,
  );
  const analysisFailure = resolveDisplayedFailure(
    displayPhase,
    state.phase,
    currentStatus,
    state.analysisFailure,
    validStatusUpdate ?? latestForCurrent,
  );

  const finalizeCompletion = useEffectEvent(async () => {
    queryClient.removeQueries({
      queryKey: ["matchmaking-analysis-status", puuid],
    });
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["matchmaking-analysis-results", puuid],
      }),
      queryClient.invalidateQueries({
        queryKey: ["matchmaking-analysis-history", puuid],
      }),
    ]);
    await refetch();
    dispatch({ type: "finalize-completed" });
  });

  useEffect(() => {
    if (displayPhase !== "completing-fast" && displayPhase !== "completing-slow") {
      return;
    }

    let timer: ReturnType<typeof setTimeout>;

    if (displayPhase === "completing-fast") {
      if (animProgress === 0) {
        timer = setTimeout(
          () => dispatch({ type: "set-anim-progress", progress: 50 }),
          120,
        );
      } else if (animProgress === 50) {
        timer = setTimeout(
          () => dispatch({ type: "set-anim-progress", progress: 100 }),
          1000,
        );
      } else if (animProgress === 100) {
        timer = setTimeout(() => {
          toast.success("Matchmaking analysis finished", {
            description: "The latest results and history are ready.",
          });
          void finalizeCompletion();
        }, 750);
      }
    } else if (displayPhase === "completing-slow") {
      toast.success("Matchmaking analysis finished", {
        description: "The latest results and history are ready.",
      });
      timer = setTimeout(() => {
        void finalizeCompletion();
      }, 1000);
    }

    return () => clearTimeout(timer);
  }, [displayPhase, animProgress, toast]);

  useEffect(() => {
    if (!storedWatching || currentStatus !== "failed") {
      return;
    }
    const terminalUpdate = validStatusUpdate ?? latestForCurrent;
    queryClient.setQueryData(["matchmaking-analysis", puuid], terminalUpdate);
    toast.error(analysisFailureMessage(terminalUpdate));
  }, [
    storedWatching,
    currentStatus,
    validStatusUpdate,
    latestForCurrent,
    queryClient,
    puuid,
    toast,
  ]);

  useEffect(() => {
    if (!storedWatching || currentStatus !== "cancelled") {
      return;
    }
    queryClient.setQueryData(
      ["matchmaking-analysis", puuid],
      validStatusUpdate ?? latestForCurrent,
    );
  }, [
    storedWatching,
    currentStatus,
    validStatusUpdate,
    latestForCurrent,
    queryClient,
    puuid,
  ]);

  const displayData = shouldPoll
    ? (validStatusUpdate ?? latestForCurrent)
    : latestAnalysis;
  const totalPlayers = displayData?.total_puuids || EXPECTED_PLAYERS;
  const authoritativeProgress = displayData?.progress || 0;
  const projectedPlayerProgress = projectMatchmakingProgress({
    ...state.progressProjection,
    authoritativeProgress,
    totalPlayers,
    nowTimestamp,
  });
  const projectedProgressPercentage = Math.min(
    (projectedPlayerProgress / totalPlayers) * 100,
    99,
  );
  const progressPercentage =
    animProgress !== null ? animProgress : projectedProgressPercentage;
  const estimatedMinutesRemaining = estimateMatchmakingMinutesRemaining(
    projectedPlayerProgress,
    totalPlayers,
  );

  if (displayPhase === "idle") {
    return (
      <MatchmakingAnalysisStartCard
        playerSelector={playerSelector}
        analysisFailure={analysisFailure}
        startPending={startMutation.isPending}
        startLabel={latestAnalysis ? "Run New Analysis" : "Start Analysis"}
        onStart={() => startMutation.mutate()}
      />
    );
  }

  if (displayPhase === "completed") {
    return (
      <MatchmakingAnalysisStartCard
        playerSelector={playerSelector}
        analysisFailure={null}
        startPending={startMutation.isPending}
        startLabel="Run New Analysis"
        onStart={() => startMutation.mutate()}
      />
    );
  }

  return (
    <MatchmakingAnalysisActiveCard
      analyzedPlayerLabel={analyzedPlayerLabel}
      phase={displayPhase}
      progressPercentage={progressPercentage}
      authoritativeProgress={authoritativeProgress}
      totalPlayers={totalPlayers}
      estimatedMinutesRemaining={estimatedMinutesRemaining}
      animProgress={animProgress}
      cancelPending={cancelMutation.isPending}
      onCancel={() => cancelMutation.mutate()}
    />
  );
}
