"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  PlayCircle,
  Clock,
  AlertCircle,
  CheckCircle,
  Loader2,
  Scale,
  StopCircle,
} from "lucide-react";

import {
  startMatchmakingAnalysis,
  getLatestMatchmakingAnalysis,
  getMatchmakingAnalysisStatus,
  cancelMatchmakingAnalysis,
} from "@/lib/core/api";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/lib/core/hooks";
import type { MatchmakingAnalysisResponse } from "@/lib/core/schemas";

interface MatchmakingAnalysisProps {
  puuid: string;
}

/**
 * State machine for the analysis UI:
 * - idle: No analysis running, show start button
 * - starting: User clicked start, waiting for backend
 * - running: Analysis is in_progress, show progress
 * - completing: Backend says completed, animating to 100%
 * - completed: Show results
 * - cancelling: User clicked cancel
 */
type UIPhase =
  | "idle"
  | "starting"
  | "running"
  | "completing-fast"
  | "completing-slow"
  | "completed"
  | "cancelling";

const EXPECTED_PLAYERS = 100;
const RIOT_LONG_WINDOW_SECONDS = 120;
// A representative warm-cache analysis completes about six Riot requests per
// logical player. This drives display-only interpolation; every real backend
// milestone still moves the projection forward immediately.
const ESTIMATED_PLAYERS_PER_WINDOW = 100 / 6;

interface ProgressProjection {
  analysisCreatedAt: string | null;
  anchorProgress: number;
  anchorTimestamp: number;
}

interface ProjectProgressInput extends ProgressProjection {
  authoritativeProgress: number;
  totalPlayers: number;
  nowTimestamp: number;
}

export function projectMatchmakingProgress({
  authoritativeProgress,
  totalPlayers,
  analysisCreatedAt,
  anchorProgress,
  anchorTimestamp,
  nowTimestamp,
}: ProjectProgressInput): number {
  if (!analysisCreatedAt || totalPlayers <= 0) {
    return Math.max(authoritativeProgress, 0);
  }

  const elapsedSeconds = Math.max(0, nowTimestamp - anchorTimestamp) / 1000;
  const projectedProgress =
    anchorProgress +
    (elapsedSeconds * ESTIMATED_PLAYERS_PER_WINDOW) /
      RIOT_LONG_WINDOW_SECONDS;
  const activeRunCap = totalPlayers * 0.99;

  return Math.min(
    Math.max(authoritativeProgress, projectedProgress),
    activeRunCap,
  );
}

export function estimateMatchmakingMinutesRemaining(
  projectedProgress: number,
  totalPlayers: number,
): number | null {
  const remainingPlayers = Math.max(0, totalPlayers - projectedProgress);
  if (remainingPlayers <= 0) {
    return null;
  }

  const remainingSeconds =
    (remainingPlayers / ESTIMATED_PLAYERS_PER_WINDOW) *
    RIOT_LONG_WINDOW_SECONDS;
  return Math.max(1, Math.ceil(remainingSeconds / 60));
}

function parseIsoTimestamp(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isSameAnalysisInstance(
  first: string | null | undefined,
  second: string | null | undefined,
): boolean {
  if (!first || !second) {
    return false;
  }

  if (first === second) {
    return true;
  }

  const firstTimestamp = parseIsoTimestamp(first);
  const secondTimestamp = parseIsoTimestamp(second);
  if (firstTimestamp === null || secondTimestamp === null) {
    return false;
  }

  return firstTimestamp === secondTimestamp;
}

function analysisFailureMessage(
  analysis: MatchmakingAnalysisResponse | null | undefined,
): string {
  switch (analysis?.error_code) {
    case "RIOT_API_KEY_INVALID":
      return "The Riot API key is invalid or expired. Please contact an administrator.";
    case "riot_service_error":
      return "Riot data could not be loaded for this analysis. Please try again.";
    case "not_enough_matches":
      return (
        analysis.error_message ??
        "This player does not have enough ranked matches for an analysis."
      );
    case "player_not_in_match":
      return "The selected player could not be verified in the latest matches.";
    default:
      return "The analysis did not finish. Please try again.";
  }
}

export function MatchmakingAnalysis({ puuid }: MatchmakingAnalysisProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<UIPhase>("idle");
  const [animProgress, setAnimProgress] = useState<number | null>(null);
  const [nowTimestamp, setNowTimestamp] = useState(() => Date.now());
  const [currentAnalysisCreatedAt, setCurrentAnalysisCreatedAt] = useState<
    string | null
  >(null);
  const [analysisFailure, setAnalysisFailure] = useState<string | null>(null);
  const [progressProjection, setProgressProjection] =
    useState<ProgressProjection>(() => ({
      analysisCreatedAt: null,
      anchorProgress: 0,
      anchorTimestamp: Date.now(),
    }));

  // Track if we ever saw in_progress this session
  const sawInProgressRef = useRef(false);
  const lastBackendProgressRef = useRef(0);

  useEffect(() => {
    const intervalId = setInterval(() => {
      setNowTimestamp(Date.now());
    }, 1000);

    return () => clearInterval(intervalId);
  }, []);

  // Query for the latest analysis
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

  // Poll for status updates only when actively running
  const shouldPoll = phase === "running" || phase === "starting";
  const { data: statusUpdate } = useQuery({
    queryKey: [
      "matchmaking-analysis-status",
      puuid,
      currentAnalysisCreatedAt,
    ],
    queryFn: async () => {
      if (!currentAnalysisCreatedAt) {
        return null;
      }
      const result = await getMatchmakingAnalysisStatus(
        puuid,
        currentAnalysisCreatedAt,
      );
      if (!result.success) {
        return null;
      }
      return result.data;
    },
    enabled: shouldPoll && Boolean(currentAnalysisCreatedAt),
    refetchInterval: 3000,
    staleTime: 0,
  });

  // Filter out stale statusUpdate data by checking if it matches current analysis
  const validStatusUpdate =
    shouldPoll &&
    statusUpdate &&
    (!currentAnalysisCreatedAt ||
      isSameAnalysisInstance(statusUpdate.created_at, currentAnalysisCreatedAt))
      ? statusUpdate
      : null;
  const latestMatchesCurrent =
    Boolean(currentAnalysisCreatedAt) &&
    isSameAnalysisInstance(
      latestAnalysis?.created_at,
      currentAnalysisCreatedAt,
    );
  const latestForCurrent = latestMatchesCurrent ? latestAnalysis : null;

  const finalizeCompletion = useCallback(async () => {
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
    setCurrentAnalysisCreatedAt(null);
    setAnimProgress(null);
    setPhase("completed");
  }, [queryClient, puuid, refetch]);

  // Detect phase transitions based on backend status
  useEffect(() => {
    // Don't react to status updates while cancelling or completing
    if (
      phase === "cancelling" ||
      phase === "completing-fast" ||
      phase === "completing-slow"
    ) {
      return;
    }

    // Only trust validStatusUpdate when actively polling, otherwise use latestAnalysis
    const currentStatus = shouldPoll
      ? (validStatusUpdate?.status ?? latestForCurrent?.status)
      : latestAnalysis?.status;
    const currentProgress = shouldPoll
      ? (validStatusUpdate?.progress ?? latestForCurrent?.progress ?? 0)
      : latestAnalysis?.progress || 0;

    // Track in_progress status - only transition to running from starting phase
    // This prevents stale statusUpdate data from incorrectly showing running state
    if (
      currentStatus === "in_progress" ||
      currentStatus === "waiting_rate_limit"
    ) {
      sawInProgressRef.current = true;
      if (phase === "starting") {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- Transitioning UI state based on polled backend status.
        setPhase("running");
      }
      if (phase === "running" || phase === "starting") {
        lastBackendProgressRef.current = currentProgress;
      }
    }

    // Detect completion
    if (currentStatus === "completed") {
      if (phase === "running" || phase === "starting") {
        // Determine animation type
        const isFast =
          !sawInProgressRef.current || lastBackendProgressRef.current < 10;

        // Reset tracking for next run
        sawInProgressRef.current = false;
        lastBackendProgressRef.current = 0;
        if (isFast) {
          setPhase("completing-fast");
          setAnimProgress(0); // Start at 0%
        } else {
          toast.success("Matchmaking analysis finished", {
            description: "The latest results and history are ready.",
          });
          setPhase("completing-slow");
          setAnimProgress(100);
        }
      } else if (phase === "idle") {
        // Just loaded with existing completed analysis
        setPhase("completed");
      }
    }

    // Transition from starting to running if we see pending/in_progress
    if (
      phase === "starting" &&
      (currentStatus === "pending" ||
        currentStatus === "in_progress" ||
        currentStatus === "waiting_rate_limit")
    ) {
      if (
        currentStatus === "in_progress" ||
        currentStatus === "waiting_rate_limit"
      ) {
        setPhase("running");
      }
    }

    if (
      currentStatus === "failed" &&
      (phase === "running" || phase === "starting")
    ) {
      const terminalUpdate = validStatusUpdate ?? latestForCurrent;
      const message = analysisFailureMessage(terminalUpdate);
      queryClient.setQueryData(
        ["matchmaking-analysis", puuid],
        terminalUpdate,
      );
      setAnalysisFailure(message);
      setCurrentAnalysisCreatedAt(null);
      setPhase("idle");
      toast.error(message);
    }

    if (
      currentStatus === "cancelled" &&
      (phase === "running" || phase === "starting")
    ) {
      queryClient.setQueryData(
        ["matchmaking-analysis", puuid],
        validStatusUpdate ?? latestForCurrent,
      );
      setCurrentAnalysisCreatedAt(null);
      setPhase("idle");
    }
  }, [
    validStatusUpdate?.status,
    validStatusUpdate?.progress,
    latestForCurrent?.status,
    latestForCurrent?.progress,
    latestAnalysis?.status,
    latestAnalysis?.progress,
    phase,
    shouldPoll,
    queryClient,
    puuid,
    validStatusUpdate,
    latestForCurrent,
    toast,
  ]);

  // Animation state machine for completion
  useEffect(() => {
    if (phase !== "completing-fast" && phase !== "completing-slow") {
      return;
    }

    let timer: ReturnType<typeof setTimeout>;

    if (phase === "completing-fast") {
      if (animProgress === 0) {
        // Wait, then go to 50%
        timer = setTimeout(() => setAnimProgress(50), 120);
      } else if (animProgress === 50) {
        // Wait for CSS transition, then go to 100%
        timer = setTimeout(() => setAnimProgress(100), 1000);
      } else if (animProgress === 100) {
        // Show toast and finish
        timer = setTimeout(() => {
          toast.success("Matchmaking analysis finished", {
            description: "The latest results and history are ready.",
          });
          finalizeCompletion();
        }, 750);
      }
    } else if (phase === "completing-slow") {
      // Just wait at 100% then finalize
      timer = setTimeout(() => {
        finalizeCompletion();
      }, 1000);
    }

    return () => clearTimeout(timer);
  }, [phase, animProgress, finalizeCompletion, toast]);

  // Initialize phase from existing data on mount
  useEffect(() => {
    if (isLoading) return;

    // Only initialize if we're in idle phase
    if (phase !== "idle") return;

    if (latestAnalysis?.status === "completed") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Initial UI state is derived from backend response.
      setPhase("completed");
    } else if (
      latestAnalysis?.status === "in_progress" ||
      latestAnalysis?.status === "waiting_rate_limit"
    ) {
      sawInProgressRef.current = true;
      setCurrentAnalysisCreatedAt(latestAnalysis.created_at);
      setProgressProjection({
        analysisCreatedAt: latestAnalysis.created_at,
        anchorProgress: latestAnalysis.progress,
        anchorTimestamp: Date.now(),
      });
      setPhase("running");
    } else if (latestAnalysis?.status === "pending") {
      setCurrentAnalysisCreatedAt(latestAnalysis.created_at);
      setProgressProjection({
        analysisCreatedAt: latestAnalysis.created_at,
        anchorProgress: latestAnalysis.progress,
        anchorTimestamp: Date.now(),
      });
      setPhase("starting");
    }
  }, [
    isLoading,
    latestAnalysis?.status,
    latestAnalysis?.created_at,
    latestAnalysis?.progress,
    latestAnalysis?.error_message,
    phase,
  ]);

  // Start analysis mutation
  const startMutation = useMutation({
    mutationFn: async () => {
      const result = await startMatchmakingAnalysis(puuid);
      if (!result.success) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    onMutate: async () => {
      // Clear any stale status data before starting new analysis
      queryClient.removeQueries({
        queryKey: ["matchmaking-analysis-status", puuid],
      });
      queryClient.setQueryData(["matchmaking-analysis", puuid], null);
      setPhase("starting");
      setAnalysisFailure(null);
      setAnimProgress(null);
      sawInProgressRef.current = false;
      lastBackendProgressRef.current = 0;
      setCurrentAnalysisCreatedAt(null);
      setProgressProjection({
        analysisCreatedAt: null,
        anchorProgress: 0,
        anchorTimestamp: Date.now(),
      });
    },
    onSuccess: (data) => {
      toast.info("Matchmaking analysis started", {
        description: "Progress will update here while the analysis runs.",
      });
      queryClient.setQueryData(["matchmaking-analysis", puuid], data);
      // Track the created_at of this new analysis
      setCurrentAnalysisCreatedAt(data.created_at);
      setProgressProjection({
        analysisCreatedAt: data.created_at,
        anchorProgress: data.progress,
        anchorTimestamp: Date.now(),
      });
      setPhase("running");
    },
    onError: () => {
      const message = "The analysis could not be started. Please try again.";
      toast.error(message);
      setAnalysisFailure(message);
      setPhase("idle");
    },
  });

  // Cancel analysis mutation
  const cancelMutation = useMutation({
    mutationFn: async () => {
      if (!currentAnalysisCreatedAt) {
        throw new Error("No active analysis is selected.");
      }
      const result = await cancelMatchmakingAnalysis(
        puuid,
        currentAnalysisCreatedAt,
      );
      if (!result.success) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    onMutate: () => {
      setPhase("cancelling");
    },
    onSuccess: async () => {
      // Clean up queries and go to idle
      queryClient.removeQueries({
        queryKey: ["matchmaking-analysis-status", puuid],
      });
      queryClient.setQueryData(["matchmaking-analysis", puuid], null);
      await queryClient.invalidateQueries({
        queryKey: ["matchmaking-analysis", puuid],
      });
      queryClient.invalidateQueries({
        queryKey: ["matchmaking-analysis-results", puuid],
      });
      queryClient.invalidateQueries({
        queryKey: ["matchmaking-analysis-history", puuid],
      });
      sawInProgressRef.current = false;
      lastBackendProgressRef.current = 0;
      setCurrentAnalysisCreatedAt(null);
      setAnimProgress(null);
      setPhase("idle");
      toast.info("Matchmaking analysis cancelled", {
        description: "The selected analysis run is no longer active.",
      });
    },
    onError: () => {
      toast.error("The analysis could not be cancelled. Please try again.");
      // Go back to running on error
      setPhase("running");
    },
  });

  // Determine current display data
  const displayData = shouldPoll
    ? (validStatusUpdate ?? latestForCurrent)
    : latestAnalysis;

  useEffect(() => {
    if (!shouldPoll || !currentAnalysisCreatedAt || !displayData) {
      return;
    }

    const authoritativeProgress = displayData.progress || 0;
    const totalPlayers = displayData.total_puuids || EXPECTED_PLAYERS;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Reanchor the display projection only when a polled backend milestone overtakes it.
    setProgressProjection((current) => {
      if (
        !isSameAnalysisInstance(
          current.analysisCreatedAt,
          currentAnalysisCreatedAt,
        )
      ) {
        return {
          analysisCreatedAt: currentAnalysisCreatedAt,
          anchorProgress: authoritativeProgress,
          anchorTimestamp: Date.now(),
        };
      }

      const projectedProgress = projectMatchmakingProgress({
        ...current,
        authoritativeProgress: current.anchorProgress,
        totalPlayers,
        nowTimestamp: Date.now(),
      });
      if (authoritativeProgress <= projectedProgress) {
        return current;
      }

      return {
        analysisCreatedAt: currentAnalysisCreatedAt,
        anchorProgress: authoritativeProgress,
        anchorTimestamp: Date.now(),
      };
    });
  }, [
    shouldPoll,
    currentAnalysisCreatedAt,
    displayData,
  ]);

  const totalPlayers = displayData?.total_puuids || EXPECTED_PLAYERS;
  const authoritativeProgress = displayData?.progress || 0;
  const projectedPlayerProgress = projectMatchmakingProgress({
    ...progressProjection,
    authoritativeProgress,
    totalPlayers,
    nowTimestamp,
  });
  const projectedProgressPercentage = Math.min(
    (projectedPlayerProgress / totalPlayers) * 100,
    99,
  );

  // Use animation progress if set, otherwise raw
  const progressPercentage =
    animProgress !== null ? animProgress : projectedProgressPercentage;
  const estimatedMinutesRemaining = estimateMatchmakingMinutesRemaining(
    projectedPlayerProgress,
    totalPlayers,
  );

  // Loading state
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scale className="h-5 w-5 text-primary" />
            Matchmaking Analysis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading analysis...</p>
        </CardContent>
      </Card>
    );
  }

  // Idle state - show start card
  if (phase === "idle") {
    return (
      <Card className="transition-all duration-300 ease-in-out">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scale className="h-5 w-5 text-primary" />
            Matchmaking Analysis
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Analyze matchmaking fairness of this player based on average of sum
            of average win rates of the last 10 matches{" "}
            <b>at the time of the match with current player</b> of all players
            in this player&apos;s last 10 matches. Visual representation of the
            calculation is under the Calculation Flowchart card.
          </p>
          {analysisFailure && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{analysisFailure}</AlertDescription>
            </Alert>
          )}

          <Button
            onClick={() => startMutation.mutate()}
            disabled={startMutation.isPending}
            className="w-full gold-gradient button-medium no-rotation"
          >
            {startMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Starting...
              </>
            ) : (
              <>
                <PlayCircle className="mr-2 h-4 w-4" />
                {latestAnalysis ? "Run New Analysis" : "Start Analysis"}
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Completed state - show start card with "Run New Analysis" button
  // Results are displayed separately in MatchmakingAnalysisResults component
  if (phase === "completed") {
    return (
      <Card className="transition-all duration-300 ease-in-out">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scale className="h-5 w-5 text-primary" />
            Matchmaking Analysis
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Analyze matchmaking fairness of this player based on average of sum
            of average win rates of the last 10 matches{" "}
            <b>at the time of the match with current player</b> of all players
            in this player&apos;s last 10 matches. Visual representation of the
            calculation is under the Calculation Flowchart card.
          </p>

          <Button
            onClick={() => startMutation.mutate()}
            disabled={startMutation.isPending}
            className="w-full gold-gradient button-medium no-rotation"
          >
            {startMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Starting...
              </>
            ) : (
              <>
                <PlayCircle className="mr-2 h-4 w-4" />
                Run New Analysis
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Active state: starting, running, completing, or cancelling
  const isCompleting =
    phase === "completing-fast" || phase === "completing-slow";
  const showAsFinished = isCompleting && animProgress === 100;

  // Build status message
  const getStatusMessage = () => {
    if (phase === "cancelling") {
      return "Cancelling analysis...";
    }

    if (isCompleting) {
      if (animProgress === 0) {
        return "Starting analysis...";
      }
      if (animProgress === 50) {
        return "Fetching matches from the database...";
      }
      return "Analysis finished successfully";
    }

    const minutesLabel =
      estimatedMinutesRemaining === 1 ? "minute" : "minutes";
    const remainingText = estimatedMinutesRemaining
      ? ` (~${estimatedMinutesRemaining} ${minutesLabel} remaining)`
      : "";
    return `Analyzing ${authoritativeProgress} of ${totalPlayers} players${remainingText}`;
  };

  return (
    <Card className="transition-all duration-300 ease-in-out">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Scale className="h-5 w-5 text-primary" />
            Matchmaking Analysis
          </span>
          {(phase === "running" || phase === "starting") && (
            <div className="flex items-center gap-2 text-sm font-normal text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>
                {displayData?.progress || 0} / {totalPlayers} players
              </span>
            </div>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status Alert */}
        <Alert>
          {showAsFinished ? (
            <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
          ) : (
            <Loader2 className="h-4 w-4 animate-spin" />
          )}
          <AlertDescription>{getStatusMessage()}</AlertDescription>
        </Alert>

        {/* Progress Bar */}
        <div className="space-y-2">
          <Progress
            value={progressPercentage}
            className="h-2 transition-all duration-700 ease-in-out"
          />
          <p className="text-xs text-muted-foreground text-center">
            {Math.round(progressPercentage)}% complete
          </p>
        </div>

        {/* Action Button */}
        {phase === "running" && (
          <Button
            onClick={() => cancelMutation.mutate()}
            disabled={cancelMutation.isPending}
            variant="destructive"
            className="w-full red-gradient"
          >
            {cancelMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Cancelling...
              </>
            ) : (
              <>
                <StopCircle className="mr-2 h-4 w-4" />
                Cancel Analysis
              </>
            )}
          </Button>
        )}
        {(phase === "starting" ||
          phase === "cancelling" ||
          isCompleting) && (
          <Button disabled className="w-full gold-gradient button-medium">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {phase === "cancelling" ? "Cancelling..." : "Analyzing..."}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
