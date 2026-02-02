"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Loader2,
  RefreshCw,
  Clock,
  StopCircle,
  ListRestart,
  Swords,
} from "lucide-react";
import { toast } from "sonner";
import Image from "next/image";

import {
  MatchListWithPlayerDataResponseSchema,
  MatchWithPlayerData,
  TeamChampion,
} from "@/lib/core/schemas";
import { validatedGet, api } from "@/lib/core/api";
import { getChampionIconUrl } from "@/lib/core/data-dragon";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
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

// Queue names mapping
const QUEUE_NAMES: Record<number, string> = {
  420: "Ranked Solo/Duo",
  440: "Ranked Flex",
  400: "Normal Draft",
  430: "Normal Blind",
  450: "ARAM",
};

// Format time as "H:MM AM/PM"
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  hours = hours ? hours : 12; // 0 should be 12
  return `${hours}:${minutes.toString().padStart(2, "0")} ${ampm}`;
}

// Format date as "D.M.YYYY"
function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getDate()}.${date.getMonth() + 1}.${date.getFullYear()}`;
}

// Format date and time as "D.M.YYYY H:MM AM/PM"
function formatDateTime(timestamp: number): string {
  return `${formatDate(timestamp)} ${formatTime(timestamp)}`;
}

// Format duration as "MM:SS"
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

// Calculate days ago from timestamp
function getDaysAgo(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return `${diffDays} days ago`;
}

// Get queue name
function getQueueName(queueId: number): string {
  return QUEUE_NAMES[queueId] || `Queue ${queueId}`;
}

// Get result text and color
function getResultInfo(match: MatchWithPlayerData): {
  text: string;
  colorClass: string;
  bgClass: string;
} {
  const participant = match.player_participant;

  if (!participant) {
    return {
      text: "Unknown",
      colorClass: "text-muted-foreground",
      bgClass: "bg-muted/30",
    };
  }

  if (participant.remake || match.early_surrender) {
    return {
      text: "REMAKE",
      colorClass: "text-gray-500",
      bgClass: "bg-gray-500/50",
    };
  }

  if (participant.win) {
    return {
      text: "VICTORY",
      colorClass: "text-emerald-500",
      bgClass: "bg-emerald-700/30",
    };
  }

  return {
    text: "DEFEAT",
    colorClass: "text-rose-500",
    bgClass: "bg-rose-600/30",
  };
}

// Match row component
function MatchRow({
  match,
  playerPuuid,
}: {
  match: MatchWithPlayerData;
  playerPuuid: string;
}) {
  const participant = match.player_participant;
  const opponent = match.lane_opponent;
  const result = getResultInfo(match);
  const teamComps = match.team_compositions;

  // Calculate CS per minute
  const csPerMinute = participant
    ? (participant.total_cs / (match.game_duration / 60)).toFixed(1)
    : "0";

  // Render a champion icon for team compositions
  const renderTeamChampIcon = (
    champ: TeamChampion,
    isCurrentPlayer: boolean,
    teamColor: "blue" | "red",
  ) => {
    const borderColor = isCurrentPlayer
      ? "ring-2 ring-yellow-400"
      : teamColor === "blue"
        ? "ring-1 ring-blue-500"
        : "ring-1 ring-red-500";

    return (
      <div
        key={champ.puuid}
        className={`relative h-6 w-6 rounded overflow-hidden shrink-0 ${borderColor}`}
        title={champ.champion_name}
      >
        <Image
          src={getChampionIconUrl(champ.champion_name)}
          alt={champ.champion_name}
          fill
          className="object-cover"
          unoptimized
        />
      </div>
    );
  };

  return (
    <div
      className={`px-3 py-1 rounded border-2 mb-1.5 border-t-1 border-b-1 border-amber-400/20 last:border-b-0 last:mb-0 ${result.bgClass}`}
    >
      <div className="flex items-center gap-4">
        {/* Column 1: Queue Type & Patch - WIDER, CENTERED VERTICALLY */}
        <div className="w-35 shrink-0 flex flex-col justify-center">
          <span className="text-sm font-medium text-center">
            {getQueueName(match.queue_id)}
          </span>
          <span className="text-xs text-muted-foreground text-center mt-1">
            Patch {match.game_version.split(".").slice(0, 2).join(".")}
          </span>
        </div>

        {/* Column 2: Date & Time - AT LEAST 1/4 WIDTH */}
        <div className="w-33 shrink-0 flex flex-col justify-center">
          <span className="text-sm text-center">
            {formatDateTime(match.game_start_timestamp)}
          </span>
          <span className="text-xs text-center text-muted-foreground mt-1">
            {getDaysAgo(match.game_start_timestamp)}
          </span>
        </div>

        {/* Column 3: Champion vs Champion - 20 rem, 3 subcolumns */}
        <div className="flex items-center gap-0 w-80">
          {/* Subcolumn 1: Player Champion (11 rem) */}
          <div className="w-44 flex items-center gap-2">
            <div className="relative h-10 w-10 rounded overflow-hidden shrink-0">
              {participant && (
                <Image
                  src={getChampionIconUrl(participant.champion_name)}
                  alt={participant.champion_name}
                  fill
                  className="object-cover"
                  unoptimized
                />
              )}
            </div>
            <div className="flex flex-col flex-1 min-w-0">
              <span className="text-sm font-medium truncate">
                {participant?.champion_name || "—"}
              </span>
              <div className="flex items-center justify-between">
                {participant && (
                  <span className="text-xs">
                    {participant.kills} / {participant.deaths} /{" "}
                    {participant.assists}
                  </span>
                )}
                <span className="text-xs text-muted-foreground ml-1">
                  {participant ? `Lv ${participant.champion_level}` : "—"}
                </span>
              </div>
            </div>
          </div>

          {/* Subcolumn 2: Swords Icon (2.5 rem) */}
          <div className="w-10 flex items-center justify-center shrink-0">
            <Swords className="h-4 w-4 text-muted-foreground" />
          </div>

          {/* Subcolumn 3: Enemy Champion (11 rem) */}
          <div className="w-44 flex items-center gap-2">
            <div className="relative h-10 w-10 rounded overflow-hidden shrink-0">
              {opponent ? (
                <Image
                  src={getChampionIconUrl(opponent.champion_name)}
                  alt={opponent.champion_name}
                  fill
                  className="object-cover"
                  unoptimized
                />
              ) : (
                <div className="h-full w-full bg-muted" />
              )}
            </div>
            <div className="flex flex-col flex-1 min-w-0">
              <span className="text-sm font-medium truncate">
                {opponent?.champion_name || "—"}
              </span>
              <div className="flex items-center justify-between">
                {opponent ? (
                  <span className="text-xs">
                    {opponent.kills} / {opponent.deaths} / {opponent.assists}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
                <span className="text-xs text-muted-foreground ml-1">
                  {opponent ? `Lv ${opponent.champion_level}` : "—"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Column 4: Stats (KDA, CS, Vision) */}
        {participant && (
          <div className="w-25 shrink-0 flex flex-col justify-center text-xs ml-2">
            <span>
              <span className="font-medium">
                {participant.kda?.toFixed(2) ?? "Perfect"}
              </span>{" "}
              KDA
            </span>
            <span className="mt-0.5">
              <span className="font-medium">{participant.total_cs}</span> CS (
              {csPerMinute}/min)
            </span>
            <span className="mt-0.5">
              <span className="font-medium">{participant.vision_score}</span>{" "}
              Vision Score
            </span>
          </div>
        )}

        {/* Column 5: Duration & Surrender */}
        <div className="w-15 shrink-0 text-center flex flex-col justify-center">
          <span className="">{formatDuration(match.game_duration)}</span>
          {/* {match.surrender && !match.early_surrender ? (
            <span className="text-xs text-muted-foreground">Surrender</span>
          ) : null} */}
        </div>

        {/* Column 6: LP Change */}
        <div className="w-15 shrink-0 text-right flex flex-col justify-center">
          {match.lp_change !== null && match.lp_change !== undefined ? (
            <span
              className={`text-xs font-medium ${
                match.lp_change > 0
                  ? "text-emerald-500"
                  : match.lp_change < 0
                    ? "text-rose-500"
                    : "text-muted-foreground"
              }`}
            >
              {match.lp_change > 0 ? "+" : ""}
              {match.lp_change} LP
            </span>
          ) : null}
        </div>

        {/* Column 7: Team Compositions (5v5) */}
        <div className="w-37 shrink-0 flex flex-col items-center justify-center gap-1">
          {teamComps ? (
            <>
              {/* Blue Team Row */}
              <div className="flex items-center gap-1 bg-blue-900/30 rounded px-1 py-0.5">
                {teamComps.blue_team.map((champ) =>
                  renderTeamChampIcon(
                    champ,
                    champ.puuid === playerPuuid,
                    "blue",
                  ),
                )}
              </div>
              {/* Vs Text */}
              <div className="text-center text-xs text-muted-foreground">
                Vs
              </div>
              {/* Red Team Row */}
              <div className="flex items-center gap-1 bg-red-900/30 rounded px-1 py-0.5">
                {teamComps.red_team.map((champ) =>
                  renderTeamChampIcon(
                    champ,
                    champ.puuid === playerPuuid,
                    "red",
                  ),
                )}
              </div>
            </>
          ) : (
            <div className="text-xs text-muted-foreground text-center">—</div>
          )}
        </div>
      </div>
    </div>
  );
}

export function MatchHistory({ puuid, queueFilter = 420 }: MatchHistoryProps) {
  const PAGE_SIZE = 20;
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const previousMatchCount = useRef(0);
  const queryClient = useQueryClient();
  const router = useRouter();

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
    queryKey: ["matchHistoryDetailed", puuid, queueFilter, displayCount],
    queryFn: async () => {
      try {
        const result = await validatedGet(
          MatchListWithPlayerDataResponseSchema,
          `/matches/player/${puuid}/detailed`,
          {
            queue: queueFilter,
            start: 0,
            count: displayCount,
          },
        );
        return result;
      } catch (err) {
        console.debug("Match history fetch error:", err);
        throw err;
      }
    },
    enabled: !!puuid,
    retry: (failureCount, error) => {
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
    onError: () => {
      toast.error("Failed to start analysis");
    },
  });

  const { data: jobStatus } = useQuery({
    queryKey: ["analysisStatus", analysisJobId],
    queryFn: async () => {
      if (!analysisJobId) return null;
      const response = await api.get<{
        status: string;
        error?: string;
        progress?: number;
        total?: number;
        message?: string;
        estimated_minutes_remaining?: number;
      }>(`/matches/analyze/status/${analysisJobId}`);
      const result = response.data;
      if (result.status === "completed" || result.status === "failed") {
        setIsAnalyzing(false);
        setAnalysisJobId(null);
        queryClient.invalidateQueries({ queryKey: ["matchHistoryDetailed"] });
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
    onError: () => {
      toast.error("Failed to cancel analysis");
      setIsAnalyzing(false);
      setAnalysisJobId(null);
    },
  });

  const handleAnalyze = () => {
    const totalAnalyzed =
      (data as { total_analyzed?: number })?.total_analyzed || 0;
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
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
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
          ? (response.error as { message: string }).message
          : String(response.error);
    }

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
              variant="outline"
              size="sm"
              className="button-small"
            >
              {isAnalyzing ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-1" />
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
                jobStatus?.total && jobStatus.total > 0
                  ? ((jobStatus.progress || 0) / jobStatus.total) * 100
                  : 0
              }
              className="h-2"
            />

            <div className="text-center text-sm text-slate-500">
              {jobStatus?.total && jobStatus.total > 0
                ? Math.round(
                    ((jobStatus.progress || 0) / jobStatus.total) * 100,
                  )
                : 0}
              % complete
            </div>

            <Button
              onClick={handleCancelAnalysis}
              variant="destructive"
              className="w-full"
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
                For non-tracked players, use the <b>Update</b> button.
              </p>
            </AlertDescription>
          </Alert>
        ) : (
          <div className="rounded-md border">
            {allMatches.map((match) => (
              <MatchRow
                key={match.match_id}
                match={match}
                playerPuuid={puuid}
              />
            ))}

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
