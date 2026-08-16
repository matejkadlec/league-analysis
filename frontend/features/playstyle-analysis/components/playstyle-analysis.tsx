"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Clock,
  RefreshCw,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { useToast } from "@/lib/core/hooks";

import {
  PlaystyleAnalysisResponseSchema,
  type PlaystyleAnalysisRequest,
} from "@/lib/core/schemas";
import { validatedPost, validatedGet } from "@/lib/core/api";
import { cn } from "@/lib/core/utils";
import { getChampionDisplayName } from "@/lib/core/data-dragon";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface PlaystyleAnalysisProps {
  puuid: string;
  matchCount?: number;
  analyzedMatchCount?: number;
}

function formatTimeAgo(dateString: string): {
  text: string;
  isOld: boolean;
} {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  let text: string;
  if (diffMins < 1) {
    text = "just now";
  } else if (diffMins < 60) {
    text = `${diffMins} minute${diffMins !== 1 ? "s" : ""} ago`;
  } else if (diffHours < 24) {
    text = `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`;
  } else {
    text = `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;
  }

  const isOld = diffHours > 24;

  return { text, isOld };
}

function formatStat(value: number): string {
  const formatted = value.toFixed(1);
  return formatted.endsWith(".0") ? formatted.slice(0, -2) : formatted;
}

export function PlaystyleAnalysis({
  puuid,
  matchCount,
  analyzedMatchCount, // Destructure new prop
}: PlaystyleAnalysisProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const analyzedMatches = analyzedMatchCount ?? 0;
  const analysisAvailabilityText =
    typeof matchCount === "number" && matchCount > 0
      ? `(${analyzedMatches}/${matchCount} fetched matches analyzed)`
      : `(${analyzedMatches}/10 analyzed)`;

  const { data: analysis, isLoading: isLoadingAnalysis } = useQuery({
    queryKey: ["playstyle-analysis", puuid],
    queryFn: async () => {
      const result = await validatedGet(
        PlaystyleAnalysisResponseSchema,
        `/playstyle-analysis/player/${puuid}`,
      );

      if (!result.success) {
        if (result.error?.status === 404) return null;
        return null;
      }
      return result.data;
    },
    retry: false,
  });

  const { mutate, isPending, error } = useMutation({
    mutationFn: async () => {
      toast.info("Playstyle analysis started", {
        description: "The selected matches are being analyzed.",
        id: "analysis-started",
      });

      // Start minimum delay timer
      const minDelayPromise = new Promise((resolve) =>
        setTimeout(resolve, 1500),
      );

      const request: PlaystyleAnalysisRequest = {
        puuid,
        force_reanalyze: true,
      };

      // Run request and delay in parallel
      const [response] = await Promise.all([
        validatedPost(
          PlaystyleAnalysisResponseSchema,
          "/playstyle-analysis/analyze",
          request,
        ),
        minDelayPromise,
      ]);

      // Check if the response was successful - throw error if not
      if (!response.success) {
        throw new Error(response.error?.message || "Analysis failed");
      }

      return response;
    },
    onSuccess: () => {
      toast.dismiss("analysis-started");
      toast.success("Playstyle analysis finished", {
        description: "The latest playstyle results are ready.",
      });
      void queryClient.invalidateQueries({
        queryKey: ["playstyle-analysis", puuid],
      });
    },
    onError: () => {
      toast.dismiss("analysis-started");
      toast.error("Playstyle analysis did not finish", {
        description: "Please try again later.",
      });
    },
  });

  const isInitialLoading = isLoadingAnalysis && !analysis;

  // Calculate colors for win rate
  let winRateColor = "text-primary";
  if (analysis?.summary_stats?.win_rate !== undefined) {
    const wr = analysis.summary_stats.win_rate * 100;
    if (wr >= 50.5) {
      winRateColor = "text-emerald-500";
    } else if (wr > 49) {
      winRateColor = "text-amber-500";
    } else {
      winRateColor = "text-rose-500";
    }
  }

  return (
    <Card className="w-full pb-2">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-xl">
            <Activity className="h-5 w-5 text-primary" />
            Playstyle Analysis
          </CardTitle>
          {analysis && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => mutate()}
              disabled={isPending}
              className="button-small"
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-1" />
              )}
              Update
            </Button>
          )}
        </div>
        <CardDescription>
          <div className="mt-2 mb-4">
            Deep dive into player behavior patterns, role preferences, and
            playstyle characteristics.
          </div>
        </CardDescription>
        {analysis && (analysis.updated_at || analysis.created_at) && (
          <div className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
            <Clock className="h-3 w-3" />
            Updated{" "}
            {formatTimeAgo(analysis.updated_at || analysis.created_at!).text}
          </div>
        )}
      </CardHeader>

      <CardContent>
        {isInitialLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : !analysis ? (
          <div className="space-y-4 pt-4">
            <div className="text-center pb-8 text-muted-foreground">
              {analyzedMatches < 10 ? (
                <p className="text-sm">
                  This player doesn&apos;t have enough matches for playstyle
                  analysis.
                </p>
              ) : (
                <p className="text-sm">
                  No playstyle analysis found for this player.
                  <br />
                  Run an analysis to discover playstyle tags.
                </p>
              )}
            </div>
            <div className="text-center">
              {/* Check if we have enough FULLY ANALYZED matches */}
              {analyzedMatches < 10 ? (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span tabIndex={0}>
                        <Button disabled size="lg" type="submit">
                          <Activity className="mr-2 h-4 w-4" />
                          Run Analysis
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>
                        This player doesn&apos;t have enough matches for the
                        analysis {analysisAvailabilityText}.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : (
                <Button
                  onClick={() => mutate()}
                  disabled={isPending}
                  size="lg"
                  type="submit"
                >
                  {isPending ? (
                    <>
                      <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <Activity className="mr-2 h-4 w-4" />
                      Run Analysis
                    </>
                  )}
                </Button>
              )}
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {error instanceof Error
                    ? error.message
                    : "Failed to run analysis."}
                </AlertDescription>
              </Alert>
            )}
          </div>
        ) : (
          <div className="space-y-3 mt-1">
            {/* Summary Section */}
            {analysis.summary_stats && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                {/* Win Rate Card */}
                <Card className="bg-muted/30 border-none shadow-none">
                  <CardContent className="p-4 flex flex-col items-center justify-center text-center">
                    <span className="text-xs uppercase text-muted-foreground font-semibold">
                      Win Rate
                    </span>
                    <span
                      className={cn("text-2xl font-bold mt-1", winRateColor)}
                    >
                      {typeof analysis.summary_stats.win_rate === "number"
                        ? `${(analysis.summary_stats.win_rate * 100).toFixed(1)}%`
                        : "N/A"}
                    </span>
                    {analysis.summary_stats.total_wins !== undefined &&
                      analysis.summary_stats.total_losses !== undefined && (
                        <span className="text-base text-muted-foreground mt-0.5">
                          {analysis.summary_stats.total_wins}W /{" "}
                          {analysis.summary_stats.total_losses}L
                        </span>
                      )}
                  </CardContent>
                </Card>

                {/* Average KDA Card */}
                <Card className="bg-muted/30 border-none shadow-none">
                  <CardContent className="p-4 flex flex-col items-center justify-center text-center">
                    <span className="text-xs uppercase text-muted-foreground font-semibold">
                      Average KDA
                    </span>
                    <span
                      className={cn(
                        "text-2xl font-bold mt-1",
                        typeof analysis.summary_stats.avg_kda === "number"
                          ? analysis.summary_stats.avg_kda < 2
                            ? "text-rose-500"
                            : analysis.summary_stats.avg_kda < 3
                              ? "text-amber-500"
                              : "text-emerald-500"
                          : "",
                      )}
                    >
                      {typeof analysis.summary_stats.avg_kda === "number"
                        ? analysis.summary_stats.avg_kda.toFixed(2)
                        : "N/A"}
                    </span>
                    {typeof analysis.summary_stats.avg_kills === "number" &&
                      typeof analysis.summary_stats.avg_deaths === "number" &&
                      typeof analysis.summary_stats.avg_assists ===
                        "number" && (
                        <span className="text-base text-muted-foreground mt-0.5">
                          {formatStat(analysis.summary_stats.avg_kills)} /{" "}
                          {formatStat(analysis.summary_stats.avg_deaths)} /{" "}
                          {formatStat(analysis.summary_stats.avg_assists)}
                        </span>
                      )}
                  </CardContent>
                </Card>

                {/* Main Role Card */}
                <Card className="bg-muted/30 border-none shadow-none">
                  <CardContent className="p-4 flex flex-col items-center justify-center text-center">
                    <span className="text-xs uppercase text-muted-foreground font-semibold">
                      Main Role
                    </span>
                    <span className="text-2xl font-bold mt-1 truncate max-w-full">
                      {!analysis.summary_stats.main_role ||
                      analysis.summary_stats.main_role === "None"
                        ? "NONE"
                        : analysis.summary_stats.main_role}
                    </span>
                    {analysis.summary_stats.main_role &&
                      analysis.summary_stats.main_role !== "None" &&
                      typeof analysis.summary_stats.main_role_win_rate ===
                        "number" && (
                        <span className="text-base text-muted-foreground mt-0.5">
                          {(
                            analysis.summary_stats.main_role_win_rate * 100
                          ).toFixed(1)}
                          % WR
                        </span>
                      )}
                  </CardContent>
                </Card>

                {/* Main Champion Card */}
                <Card className="bg-muted/30 border-none shadow-none">
                  <CardContent className="p-4 flex flex-col items-center justify-center text-center">
                    <span className="text-xs uppercase text-muted-foreground font-semibold">
                      Main Champion
                    </span>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-xl font-bold mt-1 truncate max-w-full cursor-default">
                            {analysis.summary_stats.most_played_champion &&
                            analysis.summary_stats.most_played_champion !==
                              "None"
                              ? getChampionDisplayName(
                                  analysis.summary_stats.most_played_champion,
                                )
                              : "—"}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>
                            {analysis.summary_stats.most_played_champion &&
                            analysis.summary_stats.most_played_champion !==
                              "None"
                              ? getChampionDisplayName(
                                  analysis.summary_stats.most_played_champion,
                                )
                              : "—"}
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    {analysis.summary_stats.most_played_champion &&
                      analysis.summary_stats.most_played_champion !== "None" &&
                      typeof analysis.summary_stats
                        .most_played_champion_win_rate === "number" && (
                        <span className="text-base text-muted-foreground mt-0.5">
                          {(
                            analysis.summary_stats
                              .most_played_champion_win_rate * 100
                          ).toFixed(1)}
                          % WR
                        </span>
                      )}
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Playstyle Tags Grid */}
            <div className="space-y-4">
              {!analysis.tags || Object.keys(analysis.tags).length === 0 ? (
                <div className="text-center py-8 border rounded-lg border-dashed text-muted-foreground text-sm">
                  No traits identified yet.
                </div>
              ) : (
                <div className="flex flex-wrap justify-center gap-3">
                  {Object.entries(analysis.tags).map(([tagCode, tagData]) => {
                    // Determine colors based on sentiment (metadata)
                    // Backend returns sentiment: positive, negative, neutral
                    const sentiment = tagData.sentiment || "neutral";

                    let colorClass =
                      "bg-secondary text-secondary-foreground border-transparent hover:bg-secondary/80";

                    if (sentiment === "positive") {
                      colorClass =
                        "bg-emerald-500/15 text-emerald-500 border-emerald-500/20 hover:bg-emerald-500/25";
                    } else if (sentiment === "negative") {
                      colorClass =
                        "bg-rose-500/15 text-rose-500 border-rose-500/20 hover:bg-rose-500/25";
                    } else if (sentiment === "neutral") {
                      colorClass =
                        "bg-amber-500/15 text-amber-500 border-amber-500/20 hover:bg-amber-500/25"; // Yellow/Orange
                    }

                    if (!tagData.threshold_met) return null;

                    return (
                      <TooltipProvider key={tagCode}>
                        <Tooltip delayDuration={300}>
                          <TooltipTrigger asChild>
                            <div
                              className={cn(
                                "inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 cursor-help select-none",
                                colorClass,
                              )}
                            >
                              {String(tagData.display_name || tagCode)}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{tagData.description}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
