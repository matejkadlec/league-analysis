import type { Dispatch } from "react";
import { unwrap } from "@/lib/core/api";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  cancelMatchmakingAnalysis,
  startMatchmakingAnalysis,
} from "../matchmaking-api";
import { useToast } from "@/lib/core/hooks";

import type { AnalysisUiAction } from "./matchmaking-analysis-state";
import {
  invalidateMatchmakingRun,
  matchmakingAnalysisQueryKey,
  matchmakingStatusQueryKey,
} from "../matchmaking-query";

export function useMatchmakingAnalysisMutations(
  puuid: string,
  watchingCreatedAt: string | null,
  dispatch: Dispatch<AnalysisUiAction>,
  runOptions: { matchCount: number; endDate: string | null },
) {
  const toast = useToast();
  const queryClient = useQueryClient();

  const startMutation = useMutation({
    mutationFn: async () => {
      return unwrap(
        await startMatchmakingAnalysis(
          puuid,
          runOptions.matchCount,
          runOptions.endDate,
        ),
      );
    },
    onMutate: async () => {
      queryClient.removeQueries({
        queryKey: matchmakingStatusQueryKey(puuid),
      });
      queryClient.setQueryData(matchmakingAnalysisQueryKey(puuid), null);
      dispatch({ type: "start-requested" });
    },
    onSuccess: (data) => {
      toast.info("Matchmaking analysis started", {
        description: "Progress will update here while the analysis runs.",
      });
      queryClient.setQueryData(matchmakingAnalysisQueryKey(puuid), data);
      dispatch({
        type: "start-succeeded",
        createdAt: data.created_at,
        progress: data.progress,
      });
    },
    onError: () => {
      const message = "The analysis could not be started. Please try again.";
      toast.error(message);
      dispatch({ type: "start-failed", message });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      if (!watchingCreatedAt) {
        throw new Error("No active analysis is selected.");
      }
      return unwrap(await cancelMatchmakingAnalysis(puuid, watchingCreatedAt));
    },
    onMutate: () => {
      dispatch({ type: "cancel-requested" });
    },
    onSuccess: async () => {
      queryClient.removeQueries({
        queryKey: matchmakingStatusQueryKey(puuid),
      });
      queryClient.setQueryData(matchmakingAnalysisQueryKey(puuid), null);
      await invalidateMatchmakingRun(queryClient, puuid);
      dispatch({ type: "cancel-succeeded" });
      toast.success("Matchmaking analysis cancelled", {
        description: "The selected analysis run is no longer active.",
      });
    },
    onError: () => {
      toast.error("The analysis could not be cancelled. Please try again.");
      dispatch({ type: "cancel-failed" });
    },
  });

  return { startMutation, cancelMutation };
}
