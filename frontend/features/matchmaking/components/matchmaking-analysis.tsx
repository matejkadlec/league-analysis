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
import { toast } from "sonner";

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

export function MatchmakingAnalysis({ puuid }: MatchmakingAnalysisProps) {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<UIPhase>("idle");
  const [animProgress, setAnimProgress] = useState<number | null>(null);
  const [nowTimestamp, setNowTimestamp] = useState(() => Date.now());
  const [estimatedRateLimitWindowSeconds, setEstimatedRateLimitWindowSeconds] =
    useState(60);
  const [currentAnalysisCreatedAt, setCurrentAnalysisCreatedAt] = useState<
    string | null
  >(null);
  const [analysisFailure, setAnalysisFailure] = useState<string | null>(null);

  // Track if we ever saw in_progress this session
  const sawInProgressRef = useRef(false);
  const lastBackendProgressRef = useRef(0);
  const wasRateLimitedRef = useRef(false);

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
          toast.success("Analysis finished successfully");
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
      const message =
        terminalUpdate?.error_message ??
        "The analysis did not finish. Please try again.";
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
          toast.success("Analysis finished successfully");
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
  }, [phase, animProgress, finalizeCompletion]);

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
      setPhase("running");
    } else if (latestAnalysis?.status === "pending") {
      setCurrentAnalysisCreatedAt(latestAnalysis.created_at);
      setPhase("starting");
    } else if (latestAnalysis?.status === "failed") {
      setAnalysisFailure(
        latestAnalysis.error_message ??
          "The analysis did not finish. Please try again.",
      );
    }
  }, [
    isLoading,
    latestAnalysis?.status,
    latestAnalysis?.created_at,
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
      setEstimatedRateLimitWindowSeconds(60);
      wasRateLimitedRef.current = false;
    },
    onSuccess: (data) => {
      toast.info("Matchmaking analysis started");
      queryClient.setQueryData(["matchmaking-analysis", puuid], data);
      // Track the created_at of this new analysis
      setCurrentAnalysisCreatedAt(data.created_at);
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
      toast.warning("Analysis cancelled");
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

  // Calculate progress percentage
  const EXPECTED_PLAYERS = 100;
  const totalPlayers = displayData?.total_puuids || EXPECTED_PLAYERS;
  const rawProgressPercentage =
    displayData && displayData.progress > 0
      ? Math.min(
          Math.round((displayData.progress / totalPlayers) * 100),
          100,
        )
      : 0;

  // Use animation progress if set, otherwise raw
  const progressPercentage =
    animProgress !== null ? animProgress : rawProgressPercentage;

  useEffect(() => {
    const resetAt = displayData?.rate_limit_reset_at;
    if (!resetAt) {
      wasRateLimitedRef.current = false;
      return;
    }

    const resetTimeMs = new Date(resetAt).getTime();
    if (!Number.isFinite(resetTimeMs)) {
      return;
    }

    const secondsRemaining = Math.max(
      1,
      Math.ceil((resetTimeMs - nowTimestamp) / 1000),
    );

    if (!wasRateLimitedRef.current) {
      setEstimatedRateLimitWindowSeconds((previousSeconds) =>
        Math.max(previousSeconds, secondsRemaining),
      );
      wasRateLimitedRef.current = true;
    }
  }, [displayData?.rate_limit_reset_at, nowTimestamp]);

  const getEstimatedMinutesRemaining = (): number | null => {
    if (!displayData) {
      return null;
    }

    const totalPlayers = displayData.total_puuids || EXPECTED_PLAYERS;
    const processedPlayers = displayData.progress || 0;
    const remainingPlayers = Math.max(0, totalPlayers - processedPlayers);
    if (remainingPlayers <= 0) {
      return null;
    }

    // Estimate requests from remaining players:
    // roughly 1 match-list call + up to 10 match-detail calls per player.
    const estimatedRemainingRequests = remainingPlayers * 11;
    const estimatedSeconds =
      (estimatedRemainingRequests / 100) * estimatedRateLimitWindowSeconds;
    return Math.max(1, Math.round(estimatedSeconds / 60));
  };

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

    // Active status
    const resetAt = displayData?.rate_limit_reset_at;
    if (resetAt) {
      const resetTime = new Date(resetAt).getTime();
      if (Number.isFinite(resetTime)) {
        const now = nowTimestamp;
        const waitSeconds = Math.max(1, Math.ceil((resetTime - now) / 1000));
        const secondLabel = waitSeconds === 1 ? "second" : "seconds";
        return `Waiting for rate limit to reset... (${waitSeconds} ${secondLabel} remaining)`;
      }
    }

    if (displayData?.total_puuids && displayData.total_puuids > 0) {
      const minutesRemaining = getEstimatedMinutesRemaining();
      const minutesLabel = minutesRemaining === 1 ? "minute" : "minutes";
      const remainingText = minutesRemaining
        ? ` (~${minutesRemaining} ${minutesLabel} remaining)`
        : "";
      const savedText =
        (displayData.requests_saved ?? 0) > 0
          ? ` (${displayData.requests_saved} requests saved)`
          : "";
      return `Analyzing player win rates... ${displayData.progress || 0} of 100 players completed${remainingText}${savedText}`;
    }

    return "Analyzing players... 0 of 100 players completed";
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
            {progressPercentage}% complete
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
