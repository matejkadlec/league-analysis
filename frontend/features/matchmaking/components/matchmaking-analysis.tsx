"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  PlayCircle,
  Clock,
  AlertCircle,
  CheckCircle,
  Loader2,
  Scale,
} from "lucide-react";

import {
  startMatchmakingAnalysis,
  getLatestMatchmakingAnalysis,
  getMatchmakingAnalysisStatus,
  checkPlayerMatches,
} from "@/lib/core/api";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";

interface MatchmakingAnalysisProps {
  puuid: string;
}

export function MatchmakingAnalysis({ puuid }: MatchmakingAnalysisProps) {
  const queryClient = useQueryClient();
  const [isStartingNewAnalysis, setIsStartingNewAnalysis] = useState(false);
  const [notEnoughMatches, setNotEnoughMatches] = useState<{
    show: boolean;
    found: number;
  } | null>(null);

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

  // Determine if we should poll based on analysis status
  const isAnalysisActive =
    latestAnalysis?.status === "pending" ||
    latestAnalysis?.status === "in_progress";

  // Poll for status updates when analysis is in progress
  const { data: statusUpdate } = useQuery({
    queryKey: ["matchmaking-analysis-status", puuid],
    queryFn: async () => {
      const result = await getMatchmakingAnalysisStatus(puuid);
      if (!result.success) {
        return null;
      }
      return result.data;
    },
    enabled: isAnalysisActive,
    refetchInterval: 3000,
    staleTime: 0,
  });

  // Handle completed status - refetch to get final results
  const prevStatusRef = useRef<string | null>(null);
  useEffect(() => {
    const currentStatus = statusUpdate?.status || latestAnalysis?.status;
    if (
      currentStatus === "completed" &&
      prevStatusRef.current !== "completed"
    ) {
      prevStatusRef.current = "completed";
      setTimeout(() => {
        refetch();
        queryClient.invalidateQueries({
          queryKey: ["matchmaking-analysis-results", puuid],
        });
        queryClient.invalidateQueries({
          queryKey: ["matchmaking-analysis-history", puuid],
        });
      }, 0);
    } else if (currentStatus) {
      prevStatusRef.current = currentStatus;
    }
  }, [
    statusUpdate?.status,
    latestAnalysis?.status,
    refetch,
    queryClient,
    puuid,
  ]);

  // Reset isStartingNewAnalysis when we detect the new analysis has loaded
  useEffect(() => {
    if (isStartingNewAnalysis && latestAnalysis) {
      if (
        latestAnalysis.status === "pending" ||
        latestAnalysis.status === "in_progress"
      ) {
        setTimeout(() => {
          setIsStartingNewAnalysis(false);
        }, 0);
      }
    }
  }, [isStartingNewAnalysis, latestAnalysis]);

  // Start analysis mutation
  const startMutation = useMutation({
    mutationFn: async () => {
      // First check if player has enough matches
      const checkResult = await checkPlayerMatches(puuid);
      if (!checkResult.success) {
        throw new Error(checkResult.error.message);
      }

      // Check if it's a "not enough matches" response
      if (
        "message" in checkResult.data &&
        "matches_required" in checkResult.data
      ) {
        setNotEnoughMatches({
          show: true,
          found: checkResult.data.matches_found,
        });
        throw new Error("Not enough matches");
      }

      // Now start the analysis
      const result = await startMatchmakingAnalysis(puuid);
      if (!result.success) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    onMutate: async () => {
      setIsStartingNewAnalysis(true);
      setNotEnoughMatches(null);
    },
    onSuccess: (data) => {
      toast.success("Matchmaking analysis started");
      queryClient.setQueryData(["matchmaking-analysis", puuid], data);
      queryClient.invalidateQueries({
        queryKey: ["matchmaking-analysis", puuid],
      });
      setIsStartingNewAnalysis(false);
    },
    onError: (error: Error) => {
      if (error.message !== "Not enough matches") {
        toast.error(`Failed to start analysis: ${error.message}`);
      }
      setIsStartingNewAnalysis(false);
    },
  });

  const handleStartAnalysis = () => {
    startMutation.mutate();
  };

  // Use status update if available, otherwise use latest analysis
  const currentStatus = isStartingNewAnalysis
    ? null
    : statusUpdate || latestAnalysis;

  const isActive =
    isStartingNewAnalysis ||
    currentStatus?.status === "pending" ||
    currentStatus?.status === "in_progress";
  const isCompleted = currentStatus?.status === "completed";

  // Calculate progress percentage - always use 100 as the total expected players
  // (10 matches * 10 players per match, may be slightly less due to duplicates)
  const EXPECTED_PLAYERS = 100;
  const progressPercentage =
    currentStatus && currentStatus.progress > 0
      ? Math.min(
          Math.round((currentStatus.progress / EXPECTED_PLAYERS) * 100),
          100,
        )
      : 0;

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

  const shouldShowStartCard = !isStartingNewAnalysis && !isActive;

  if (shouldShowStartCard) {
    return (
      <Card>
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
            in this player's last 10 matches. Visual representation of the
            calculation is under the Calculation Flowchart card.
          </p>
          {notEnoughMatches?.show && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Player doesn't have enough matches for this analysis. Found{" "}
                {notEnoughMatches.found} matches, need at least 10.
              </AlertDescription>
            </Alert>
          )}

          <Button
            onClick={handleStartAnalysis}
            disabled={startMutation.isPending}
            className="w-full matchmaking-start-btn button-medium"
          >
            {isStartingNewAnalysis || startMutation.isPending ? (
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Scale className="h-5 w-5 text-primary" />
            Matchmaking Analysis
          </span>
          {isActive && (
            <div className="flex items-center gap-2 text-sm font-normal text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>{currentStatus?.progress || 0} / 100 players</span>
            </div>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status Alert */}
        {isActive && (
          <Alert>
            <Loader2 className="h-4 w-4 animate-spin" />
            <AlertDescription>
              {(() => {
                const waitSeconds = currentStatus?.rate_limit_wait_seconds ?? 0;
                if (waitSeconds > 0) {
                  return `Waiting for rate limit to reset... (${waitSeconds} seconds remaining)`;
                }
                if (
                  currentStatus?.total_puuids &&
                  currentStatus.total_puuids > 0
                ) {
                  const savedText =
                    (currentStatus.requests_saved ?? 0) > 0
                      ? ` (${currentStatus.requests_saved} requests saved)`
                      : "";
                  return `Analyzing player win rates... ${currentStatus.progress || 0} of 100 players completed${savedText}`;
                }
                return "Starting analysis...";
              })()}
            </AlertDescription>
          </Alert>
        )}

        {/* Progress Bar */}
        {isActive && (
          <div className="space-y-2">
            <Progress value={progressPercentage} className="h-2" />
            <p className="text-xs text-muted-foreground text-center">
              {progressPercentage}% complete
            </p>
          </div>
        )}

        {/* Results Table */}
        {isCompleted && currentStatus?.results && !isStartingNewAnalysis && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
              <CheckCircle className="h-4 w-4" />
              <span>Analysis completed successfully</span>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Team</TableHead>
                  <TableHead className="text-right">
                    Average Winrate (Last 10 Matches)
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-medium">Your Team</TableCell>
                  <TableCell className="text-right font-mono">
                    {(currentStatus.results.team_avg_winrate * 100).toFixed(1)}%
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Enemy Team</TableCell>
                  <TableCell className="text-right font-mono">
                    {(currentStatus.results.enemy_avg_winrate * 100).toFixed(1)}
                    %
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>

            <p className="text-xs text-muted-foreground">
              Based on {currentStatus.results.matches_analyzed} ranked matches
            </p>
          </div>
        )}

        {/* Action Button */}
        <Button
          onClick={handleStartAnalysis}
          disabled={
            isStartingNewAnalysis || startMutation.isPending || isActive
          }
          className="w-full matchmaking-start-btn"
        >
          {isStartingNewAnalysis || startMutation.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Starting...
            </>
          ) : isActive ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Analysis in progress...
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
