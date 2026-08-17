import type { Dispatch } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  cancelMatchmakingAnalysis,
  startMatchmakingAnalysis,
} from "@/lib/core/api";
import { useToast } from "@/lib/core/hooks";

import type { AnalysisUiAction } from "./matchmaking-analysis-state";

export function useMatchmakingAnalysisMutations(
  puuid: string,
  watchingCreatedAt: string | null,
  dispatch: Dispatch<AnalysisUiAction>,
) {
  const toast = useToast();
  const queryClient = useQueryClient();

  const startMutation = useMutation({
    mutationFn: async () => {
      const result = await startMatchmakingAnalysis(puuid);
      if (!result.success) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    onMutate: async () => {
      queryClient.removeQueries({
        queryKey: ["matchmaking-analysis-status", puuid],
      });
      queryClient.setQueryData(["matchmaking-analysis", puuid], null);
      dispatch({ type: "start-requested" });
    },
    onSuccess: (data) => {
      toast.info("Matchmaking analysis started", {
        description: "Progress will update here while the analysis runs.",
      });
      queryClient.setQueryData(["matchmaking-analysis", puuid], data);
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
      const result = await cancelMatchmakingAnalysis(puuid, watchingCreatedAt);
      if (!result.success) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    onMutate: () => {
      dispatch({ type: "cancel-requested" });
    },
    onSuccess: async () => {
      queryClient.removeQueries({
        queryKey: ["matchmaking-analysis-status", puuid],
      });
      queryClient.setQueryData(["matchmaking-analysis", puuid], null);
      await queryClient.invalidateQueries({
        queryKey: ["matchmaking-analysis", puuid],
      });
      void queryClient.invalidateQueries({
        queryKey: ["matchmaking-analysis-results", puuid],
      });
      void queryClient.invalidateQueries({
        queryKey: ["matchmaking-analysis-history", puuid],
      });
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

  return { toast, queryClient, startMutation, cancelMutation };
}
