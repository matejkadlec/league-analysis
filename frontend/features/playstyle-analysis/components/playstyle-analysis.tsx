"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Clock,
  RefreshCw,
  Trophy,
  Target,
  Swords,
  Shield,
  Zap,
  Info,
  User,
  AlertCircle,
  Loader2,
} from "lucide-react";

import {
  PlaystyleAnalysisResponseSchema,
  type PlaystyleAnalysisRequest,
  type PlaystyleAnalysisResponse,
} from "@/lib/core/schemas";
import { validatedPost, validatedGet } from "@/lib/core/api";
import { cn } from "@/lib/core/utils";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";

interface PlaystyleAnalysisProps {
  puuid: string;
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

// Map specialized icons for certain tags if needed
const getTagIcon = (tagCode: string) => {
  const code = tagCode.toLowerCase();
  if (code.includes("laner")) return <Swords className="h-4 w-4" />;
  if (code.includes("otp")) return <Target className="h-4 w-4" />;
  if (code.includes("aggr")) return <Zap className="h-4 w-4" />;
  if (code.includes("safe")) return <Shield className="h-4 w-4" />;
  if (code.includes("farm")) return <Trophy className="h-4 w-4" />;
  return <Activity className="h-4 w-4" />;
};

export function PlaystyleAnalysis({ puuid }: PlaystyleAnalysisProps) {
  const queryClient = useQueryClient();

  const { data: analysis, isLoading: isLoadingAnalysis } = useQuery({
    queryKey: ["playstyle-analysis", puuid],
    queryFn: async () => {
      const result = await validatedGet(
        PlaystyleAnalysisResponseSchema,
        `/playstyle-analysis/player/${puuid}`,
      );

      if (!result.success) {
        if (result.error?.status === 404) return null;
        // Return null if error to allow UI to show empty state or fallback,
        // though validatedGet might not provide status in all error shapes.
        // Let's assume non-2xx throws or returns success: false
        return null;
      }
      return result.data;
    },
    retry: false,
  });

  const { mutate, isPending, error } = useMutation({
    mutationFn: async () => {
      const request: PlaystyleAnalysisRequest = {
        puuid,
        force_reanalyze: true,
      };
      return validatedPost(
        PlaystyleAnalysisResponseSchema,
        "/playstyle-analysis/analyze",
        request,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["playstyle-analysis", puuid],
      });
    },
  });

  const isInitialLoading = isLoadingAnalysis && !analysis;

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          Playstyle Analysis
        </CardTitle>
        <CardDescription>
          Deep dive into player behavior patterns, role preferences, and
          playstyle characteristics.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isInitialLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : !analysis ? (
          <div className="space-y-4">
            <div className="text-center py-8 text-muted-foreground">
              <p>No playstyle analysis found for this player.</p>
              <p className="text-sm">
                Run an analysis to discover playstyle tags.
              </p>
            </div>
            <div className="text-center">
              <Button onClick={() => mutate()} disabled={isPending} size="lg">
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
          <div className="space-y-12">
            {/* Status & Timestamp Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                {analysis.created_at ? (
                  <span>
                    Analyzed {formatTimeAgo(analysis.created_at).text}
                  </span>
                ) : (
                  <span>Just now</span>
                )}
              </div>
              <div>
                <Button
                  onClick={() => mutate()}
                  disabled={isPending}
                  type="submit"
                  className="text-xs px-2.5 py-0.5 gap-1.5"
                >
                  {isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  Refresh
                </Button>
              </div>
            </div>

            {/* Summary Section */}
            {analysis.summary_stats && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card className="bg-muted/50 border-none shadow-none">
                  <CardContent className="p-4 flex flex-col items-center justify-center text-center">
                    <span className="text-sm text-muted-foreground font-medium">
                      Win Rate
                    </span>
                    <span className="text-2xl font-bold">
                      {typeof analysis.summary_stats.win_rate === "number"
                        ? `${(analysis.summary_stats.win_rate * 100).toFixed(1)}%`
                        : "N/A"}
                    </span>
                  </CardContent>
                </Card>
                <Card className="bg-muted/50 border-none shadow-none">
                  <CardContent className="p-4 flex flex-col items-center justify-center text-center">
                    <span className="text-sm text-muted-foreground font-medium">
                      Total Games
                    </span>
                    <span className="text-2xl font-bold">
                      {analysis.summary_stats.total_games || 0}
                    </span>
                  </CardContent>
                </Card>
                <Card className="bg-muted/50 border-none shadow-none">
                  <CardContent className="p-4 flex flex-col items-center justify-center text-center">
                    <span className="text-sm text-muted-foreground font-medium">
                      Main Role
                    </span>
                    <span className="text-xl font-bold truncate max-w-full">
                      {analysis.summary_stats.main_role || "Fill"}
                    </span>
                  </CardContent>
                </Card>
                <Card className="bg-muted/50 border-none shadow-none">
                  <CardContent className="p-4 flex flex-col items-center justify-center text-center">
                    <span className="text-sm text-muted-foreground font-medium">
                      Avg KDA
                    </span>
                    <span className="text-2xl font-bold">
                      {typeof analysis.summary_stats.avg_kda === "number"
                        ? analysis.summary_stats.avg_kda.toFixed(2)
                        : "N/A"}
                    </span>
                  </CardContent>
                </Card>
              </div>
            )}

            <Separator />

            {/* Playstyle Tags Grid */}
            <div>
              <h3 className="text-base font-semibold mb-4 flex items-center gap-2">
                <Target className="h-5 w-5 text-primary" />
                Playstyle Traits
              </h3>
              {!analysis.tags || Object.keys(analysis.tags).length === 0 ? (
                <p className="text-muted-foreground italic">
                  No specific playstyle traits identified yet.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {Object.entries(analysis.tags).map(([tagCode, tagData]) => (
                    <TooltipProvider key={tagCode}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div
                            className={cn(
                              "flex items-center gap-3 p-3 rounded-lg border transition-colors hover:bg-muted/50",
                              tagData.threshold_met
                                ? "opacity-100 bg-background"
                                : "opacity-50 grayscale bg-muted/20",
                            )}
                          >
                            <div
                              className={cn(
                                "p-2 rounded-full",
                                tagData.threshold_met
                                  ? "bg-primary/10 text-primary"
                                  : "bg-muted text-muted-foreground",
                              )}
                            >
                              {getTagIcon(tagCode)}
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center justify-between">
                                <span className="font-semibold capitalize">
                                  {tagCode}
                                </span>
                                {tagData.threshold_met && (
                                  <Badge
                                    variant="secondary"
                                    className="text-xs"
                                  >
                                    Active
                                  </Badge>
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground line-clamp-1">
                                {tagData.description}
                              </div>
                            </div>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="right">
                          <div className="space-y-1">
                            <p className="font-semibold">{tagCode}</p>
                            <p className="text-sm max-w-xs">
                              {tagData.description}
                            </p>
                            {tagData.details && (
                              <p className="text-xs mt-1 text-muted-foreground">
                                {tagData.details}
                              </p>
                            )}
                            <p className="text-xs mt-2 font-mono">
                              Score: {tagData.value.toFixed(2)}
                            </p>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
