"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  History,
  AlertCircle,
  Loader2,
  RefreshCw,
  Clock,
  StopCircle,
  ListRestart,
} from "lucide-react";
import { toast } from "sonner";

import { MatchListResponseSchema } from "@/lib/core/schemas";
import { validatedGet, api } from "@/lib/core/api";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface MatchHistoryProps {
  puuid: string;
  queueFilter?: number;
}

// TODO: [SPY-64]
// 1. Show less matches on initial load (10/15/20).
// 2. Make the component scrollable, so the user scrolls through the component, rather than through
// whole page. This ensures that other components will be shown on the page, as well as the sidebar
// footer, which currently dissappears when the MatchHistoy is shown, and scrolling down pushes it
// down as well, making it impossible to see it for th user.
// 3. Ensure the sidebar footer is shown even if this component goes off the page, this is probably
// more of a sidebar problem, but as it's closely related to this, and will be most likely quick
// fix, we can do it in one ticket
export function MatchHistory({ puuid, queueFilter = 420 }: MatchHistoryProps) {
  const PAGE_SIZE = 20;
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const previousMatchCount = useRef(0);
  const queryClient = useQueryClient();
  const router = useRouter();

  // Component uses key={`${puuid}-${queueFilter}`} to reset state on prop changes
  // This avoids calling setState in useEffect which violates React Compiler rules
  const [displayCount, setDisplayCount] = useState(20);
  const [analysisJobId, setAnalysisJobId] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showAnalysisConfirm, setShowAnalysisConfirm] = useState(false);

  const {
    data: response,
    isLoading,
    error,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["matchHistory", puuid, queueFilter, displayCount],
    queryFn: async () => {
      try {
        const result = await validatedGet(
          MatchListResponseSchema,
          `/matches/player/${puuid}`,
          {
            queue: queueFilter,
            start: 0,
            count: displayCount,
          },
        );
        return result;
      } catch (err) {
        // Handle network errors gracefully
        console.debug("Match history fetch error:", err);
        throw err;
      }
    },
    enabled: !!puuid,
    retry: (failureCount, error) => {
      // Don't retry on network errors, but allow retries on other errors
      if (
        error instanceof Error &&
        (error.message.includes("Network Error") ||
          error.message.includes("ERR_NETWORK"))
      ) {
        return false;
      }
      return failureCount < 2;
    },
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    placeholderData: (previousData) => previousData,
    staleTime: 60000,
    refetchInterval: (query) => {
      const data = query.state.data;
      // Auto-refetch if we have no matches yet (waiting for background job)
      if (
        data?.success &&
        data.data?.matches &&
        data.data.matches.length === 0
      ) {
        return 5000;
      }
      return false;
    },
  });

  const { mutate: analyzeMutate } = useMutation({
    mutationFn: async () => {
      const resp = await api.post<{ job_id: string; status: string }>(
        `/matches/analyze/${puuid}`,
      );
      return resp.data.job_id;
    },
    onSuccess: (jobId) => {
      setAnalysisJobId(jobId);
      setIsAnalyzing(true);
      toast.success("Match history analysis started");
    },
    onError: (err) => {
      toast.error("Failed to start analysis");
      console.error(err);
    },
  });

  // Poll for status updates
  const { data: jobStatus } = useQuery({
    queryKey: ["analysisStatus", analysisJobId],
    queryFn: async () => {
      if (!analysisJobId) return null;
      const response = await api.get<any>(
        `/matches/analyze/status/${analysisJobId}`,
      );
      const result = response.data;
      if (result.status === "completed" || result.status === "failed") {
        setIsAnalyzing(false);
        setAnalysisJobId(null);

        // Refresh client-side data
        queryClient.invalidateQueries({ queryKey: ["matchHistory"] });

        // Refresh server-side data (Next.js App Router)
        router.refresh();

        if (result.status === "completed") {
          toast.success("Analysis complete!");
        } else {
          toast.error(result.error || "Analysis failed");
        }
      } else if (
        result.status === "pending" ||
        result.status === "in_progress"
      ) {
        // Force update for initial state
        setIsAnalyzing(true);
      }
      return result;
    },
    enabled: !!analysisJobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "completed" || status === "failed" ? false : 2000;
    },
  });

  const { mutate: cancelMutate } = useMutation({
    mutationFn: async () => {
      if (!analysisJobId) return;
      await api.post(`/matches/analyze/cancel/${analysisJobId}`);
    },
    onSuccess: () => {
      toast.info("Analysis cancelled.");
      setIsAnalyzing(false);
      setAnalysisJobId(null);
    },
    onError: (err) => {
      toast.error("Failed to cancel analysis");
      console.error(err);
      // Still close UI to avoid stuck state
      setIsAnalyzing(false);
      setAnalysisJobId(null);
    },
  });

  const handleAnalyze = () => {
    // Check for high number of analyzed matches
    const totalAnalyzed = (data as any)?.total_analyzed || 0;
    console.debug("Analyze request check", { totalAnalyzed });

    if (totalAnalyzed >= 50) {
      setShowAnalysisConfirm(true);
    } else {
      analyzeMutate();
    }
  };

  const handleConfirmAnalyze = () => {
    setShowAnalysisConfirm(false);
    analyzeMutate();
  };

  const handleCancelAnalysis = () => {
    cancelMutate();
  };

  const data = response?.success ? response.data : null;
  const allMatches = data?.matches || [];
  const totalMatches = data?.total || 0;
  const hasMore = allMatches.length < totalMatches;
  // Preserve scroll position when new matches load
  useEffect(() => {
    if (
      allMatches.length > previousMatchCount.current &&
      previousMatchCount.current > 0
    ) {
      previousMatchCount.current = allMatches.length;
    } else if (allMatches.length > 0) {
      previousMatchCount.current = allMatches.length;
    }
  }, [allMatches.length]);

  const loadMore = useCallback(() => {
    if (!isFetching && hasMore) {
      setDisplayCount((prev) => prev + PAGE_SIZE);
    }
  }, [isFetching, hasMore]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (first.isIntersecting) {
          loadMore();
        }
      },
      { threshold: 0.1, rootMargin: "100px" },
    );

    const currentRef = loadMoreRef.current;
    if (currentRef) {
      observer.observe(currentRef);
    }

    return () => {
      if (currentRef) {
        observer.unobserve(currentRef);
      }
    };
  }, [loadMore]);

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const getQueueName = (queueId: number) => {
    const queues: Record<number, string> = {
      420: "Ranked Solo/Duo",
      440: "Ranked Flex",
      400: "Normal Draft",
      430: "Normal Blind",
      450: "ARAM",
    };
    return queues[queueId] || `Queue ${queueId}`;
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListRestart className="h-5 w-5 text-primary" />
            Match History
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error || (response && !response.success)) {
    let errorMessage = "Failed to load matches";

    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (response && !response.success && response.error) {
      errorMessage =
        typeof response.error === "object" && "message" in response.error
          ? response.error.message
          : String(response.error);
    }

    // Handle specific network error messages
    if (
      errorMessage.includes("Network Error") ||
      errorMessage.includes("ERR_NETWORK")
    ) {
      errorMessage =
        "Network connection failed. Please check your internet connection.";
    }

    const isNotFound =
      errorMessage.toLowerCase().includes("not found") ||
      (error instanceof Error && error.message.includes("404"));

    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListRestart className="h-5 w-5 text-primary" />
            Match History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {isNotFound ? (
                <div className="space-y-2">
                  <p>No matches found for this player.</p>
                  <p className="text-sm text-muted-foreground">
                    This could mean the player has no ranked games, or match
                    data is not yet available.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p>{errorMessage}</p>
                  <Button
                    onClick={() => refetch()}
                    type="submit"
                    size="sm"
                    className="mt-2"
                  >
                    Retry
                  </Button>
                </div>
              )}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <ListRestart className="h-5 w-5 text-primary" />
            Match History
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              onClick={handleAnalyze}
              disabled={isAnalyzing}
              type="submit"
              className="button-small"
            >
              {isAnalyzing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Update
            </Button>
          </div>
        </div>

        {isAnalyzing && (
          <div className="mt-4 p-4 rounded-lg bg-slate-950 border border-slate-800 space-y-4">
            <div className="flex items-center justify-between text-sm text-slate-400">
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                {jobStatus?.message || "Initializing..."}
              </span>
              <span className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                {jobStatus?.estimated_minutes_remaining
                  ? `~${jobStatus.estimated_minutes_remaining} min remaining`
                  : "~2 min remaining"}
              </span>
            </div>

            <Progress
              value={
                jobStatus?.total > 0
                  ? (jobStatus.progress / jobStatus.total) * 100
                  : 0
              }
              className="h-2"
            />

            <div className="text-center text-sm text-slate-500">
              {jobStatus?.total > 0
                ? Math.round((jobStatus.progress / jobStatus.total) * 100)
                : 0}
              % complete
            </div>

            <Button
              onClick={handleCancelAnalysis}
              variant="destructive"
              className="w-full matchmaking-cancel-btn"
              size="sm"
            >
              <StopCircle className="mr-2 h-4 w-4" />
              Cancel Analysis
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {allMatches.length === 0 ? (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <p className="font-medium">
                This player has no matches in the database.
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                Tracked players matches will appear here as a background job
                fetches them from the Riot API. If player is tracked and matches
                are not appearing even after a few minutes, something is wrong.
                For non-tracked players, use the <b>Analyze Match History</b>{" "}
                button.
              </p>
            </AlertDescription>
          </Alert>
        ) : (
          <div className="rounded-md border max-h-[600px] overflow-y-auto relative">
            <Table>
              <TableHeader className="bg-background sticky top-0 z-10 shadow-sm">
                <TableRow>
                  <TableHead>Queue</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allMatches.map((match) => (
                  <TableRow key={match.match_id}>
                    <TableCell className="font-medium">
                      {getQueueName(match.queue_id)}
                    </TableCell>
                    <TableCell>
                      {formatDate(match.game_start_timestamp)}
                    </TableCell>
                    <TableCell>{formatDuration(match.game_duration)}</TableCell>
                    <TableCell>
                      <span className="font-mono text-xs">
                        {match.patch_version ||
                          match.game_version.split(".").slice(0, 2).join(".")}
                      </span>
                    </TableCell>
                    <TableCell>
                      {match.fully_analyzed ? (
                        <Badge variant="default">Analyzed</Badge>
                      ) : (
                        <Badge variant="secondary">Pending</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {hasMore && (
              <div
                ref={loadMoreRef}
                className="flex justify-center py-4 border-t bg-background/50"
              >
                {isFetching ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">Loading more matches...</span>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    Showing {allMatches.length} of {totalMatches} matches
                  </div>
                )}
              </div>
            )}
            {!hasMore && allMatches.length > 0 && (
              <div className="flex justify-center py-4 border-t bg-background/50">
                <div className="text-sm text-muted-foreground">
                  All {totalMatches} matches loaded
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>

      <Dialog open={showAnalysisConfirm} onOpenChange={setShowAnalysisConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Analyze Match History?</DialogTitle>
            <DialogDescription>
              This player already has 50 or more analyzed matches, do you wish
              to proceed?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowAnalysisConfirm(false)}
            >
              No
            </Button>
            <Button onClick={handleConfirmAnalyze}>Yes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
