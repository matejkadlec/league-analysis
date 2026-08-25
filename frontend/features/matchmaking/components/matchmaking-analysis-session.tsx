"use client";

import { useEffect, useEffectEvent, useReducer, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import { unwrapOr404 } from "@/lib/core/api";

import { getMatchmakingAnalysisStatus } from "../matchmaking-api";
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
import {
  invalidateMatchmakingRun,
  matchmakingAnalysisQueryKey,
  matchmakingStatusQueryKey,
} from "../matchmaking-query";

export interface MatchmakingAnalysisSessionProps {
  puuid: string;
  analyzedPlayerLabel: string;
  playerSelector: ReactNode;
  latestAnalysis: MatchmakingAnalysisResponse | null;
}

export function MatchmakingAnalysisSession({
  puuid,
  analyzedPlayerLabel,
  playerSelector,
  latestAnalysis,
}: MatchmakingAnalysisSessionProps) {
  const [state, dispatch] = useReducer(
    analysisUiReducer,
    latestAnalysis,
    initAnalysisUiState,
  );
  const [nowTimestamp, setNowTimestamp] = useState(() => Date.now());

  const watchingCreatedAt = resolveWatchingCreatedAt(state, latestAnalysis);
  const { toast, queryClient, startMutation, cancelMutation } =
    useMatchmakingAnalysisMutations(puuid, watchingCreatedAt, dispatch);
  const storedWatching = state.phase === "running" || state.phase === "starting";
  const latestMatchesCurrent =
    Boolean(watchingCreatedAt) &&
    isSameAnalysisInstance(latestAnalysis?.created_at, watchingCreatedAt);
  const latestForCurrent = latestMatchesCurrent ? latestAnalysis : null;

  const { data: statusUpdate } = useQuery({
    queryKey: [...matchmakingStatusQueryKey(puuid), watchingCreatedAt],
    queryFn: async () => {
      if (!watchingCreatedAt) {
        return null;
      }
      // A 404 is the ordinary end of a watch -- the record was deleted, or
      // the stored `watchingCreatedAt` outlived it -- so it resolves to
      // "nothing to report". Every other failure throws through to the toast;
      // returning null would leave the card animating an untracked run.
      const status = unwrapOr404(
        await getMatchmakingAnalysisStatus(puuid, watchingCreatedAt),
        null,
      );
      if (!status) {
        return null;
      }
      if (
        status.status === "in_progress" ||
        status.status === "waiting_rate_limit"
      ) {
        dispatch({
          type: "observe-active-progress",
          progress: status.progress,
        });
      }
      dispatch({
        type: "consider-reanchor",
        analysisCreatedAt: watchingCreatedAt,
        authoritativeProgress: status.progress || 0,
        totalPlayers: status.total_puuids || EXPECTED_PLAYERS,
      });
      return status;
    },
    meta: { errorTitle: "Analysis progress could not be checked" },
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
  // Only the running projection reads this clock. With empty deps it ticked
  // for the life of the page, re-rendering the whole session card once a
  // second behind a completed result nobody is watching change.
  const isProjecting = displayPhase === "running" || displayPhase === "starting";

  useEffect(() => {
    if (!isProjecting) {
      return;
    }
    const intervalId = setInterval(() => {
      setNowTimestamp(Date.now());
    }, 1000);

    return () => clearInterval(intervalId);
  }, [isProjecting]);

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
      queryKey: matchmakingStatusQueryKey(puuid),
    });
    await invalidateMatchmakingRun(queryClient, puuid);
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
    } else {
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
    queryClient.setQueryData(
      matchmakingAnalysisQueryKey(puuid),
      terminalUpdate,
    );
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
      matchmakingAnalysisQueryKey(puuid),
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
