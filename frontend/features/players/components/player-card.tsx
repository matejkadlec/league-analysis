"use client";

import Image from "next/image";
import {
  Player,
  PlayerLeagueSchema,
  MatchStatsResponseSchema,
} from "@/lib/core/schemas";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { User, Trophy, RefreshCw, Loader2, Clock, StarOff } from "lucide-react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { validatedGet, api, untrackPlayer } from "@/lib/core/api";
import { getPlatformDisplayName } from "@/lib/core/platform-utils";
import { getProfileIconUrl } from "@/lib/core/data-dragon";
import { toast } from "sonner";
import { useState } from "react";
import { useAuth } from "@/features/auth";
import { getRankColors } from "@/features/players/utils/rank-colors";

interface PlayerCardProps {
  player: Player;
  onRefreshAll?: () => void;
}

// Helper function to get win rate color based on percentage
function getWinRateColor(winRate: number): string {
  if (winRate >= 51) {
    return "text-green-500";
  } else if (winRate > 49) {
    return "text-yellow-500";
  } else {
    return "text-rose-500";
  }
}

// Helper function to get win rate bar color based on percentage
function getWinRateBarColor(winRate: number): string {
  if (winRate >= 51) {
    return "bg-green-500";
  } else if (winRate > 49) {
    return "bg-yellow-500";
  } else {
    return "bg-rose-500";
  }
}

// Format win rate - remove .0 if whole number
// Handles both decimal (0-1) and percentage (0-100) formats
function formatWinRate(winRate: number): string {
  // Convert to percentage if it's in decimal format (0-1)
  const percent = winRate <= 1 ? winRate * 100 : winRate;
  const formatted = percent.toFixed(1);
  return formatted.endsWith(".0") ? Math.round(percent).toString() : formatted;
}

// Format date for display
function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return "Never";
  return new Date(dateString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Format relative time (like "just now", "5 minutes ago", "2 hours ago")
function formatRelativeTime(dateString: string | null | undefined): string {
  if (!dateString) return "Never";

  const now = new Date();
  const date = new Date(dateString);
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return "just now";
  if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? "s" : ""} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;

  return formatDate(dateString);
}

export function PlayerCard({ player, onRefreshAll }: PlayerCardProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id;
  const [isUpdating, setIsUpdating] = useState(false);
  const [isHoveringTracked, setIsHoveringTracked] = useState(false);

  // Fetch player league
  const { data: league, refetch: refetchLeague } = useQuery({
    queryKey: ["player-league", player.puuid],
    queryFn: async () => {
      const result = await validatedGet(
        PlayerLeagueSchema.nullable(),
        `/players/${player.puuid}/league`,
      );
      if (!result.success) {
        return null;
      }
      return result.data;
    },
    retry: false,
  });

  // Fetch player stats (all matches)
  const { data: stats, refetch: refetchStats } = useQuery({
    queryKey: ["player-stats", player.puuid, 420],
    queryFn: async () => {
      const result = await validatedGet(
        MatchStatsResponseSchema,
        `/matches/player/${player.puuid}/stats`,
        { queue: 420 },
      );
      if (!result.success) {
        return null;
      }
      return result.data;
    },
    retry: false,
  });

  // Handle update button click - triggers match fetcher + player updater jobs
  const handleUpdate = async () => {
    setIsUpdating(true);
    try {
      // Trigger the unified player sync (match fetcher + player updater)
      const response = await api.post<{ success: boolean; message: string }>(
        `/jobs/sync-player/${player.puuid}`,
      );

      if (!response.data.success) {
        // Job is already running
        toast.info(response.data.message);
        setIsUpdating(false);
        return;
      }

      // Show success message - data will be updated by jobs
      toast.success("Update started", {
        description:
          "Match history and profile are being synced. Refresh in a moment.",
      });

      // Wait a bit then refetch data
      setTimeout(async () => {
        await Promise.all([
          refetchLeague(),
          refetchStats(),
          queryClient.invalidateQueries({ queryKey: ["player", player.puuid] }),
          queryClient.invalidateQueries({ queryKey: ["matchHistoryDetailed"] }),
          queryClient.invalidateQueries({ queryKey: ["match-history-stats"] }),
        ]);
        // Call parent refresh callback if provided
        if (onRefreshAll) {
          onRefreshAll();
        }
        setIsUpdating(false);
      }, 3000);
    } catch {
      toast.error("Failed to start update");
      setIsUpdating(false);
    }
  };

  // Untrack mutation
  const untrackMutation = useMutation({
    mutationFn: async () => {
      const response = await untrackPlayer(player.puuid);
      if (!response.success) {
        throw new Error(response.error.message);
      }
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["player", player.puuid] });
      queryClient.invalidateQueries({ queryKey: ["tracked-players", userId] });
      queryClient.invalidateQueries({
        queryKey: ["tracking-status", userId, player.puuid],
      });
      toast.success("Player untracked");
    },
    onError: (error: Error) => {
      toast.error("Failed to untrack player", {
        description: error.message,
      });
    },
  });

  const handleUntrack = () => {
    untrackMutation.mutate();
  };

  const leagueColors = league ? getRankColors(league.tier) : null;

  return (
    <Card id="player-summary">
      <CardHeader className="pb-3">
        {/* First Part: Header Row */}
        <div className="flex items-center space-x-3">
          {/* Profile Icon */}
          <div
            className="relative h-18 w-18 rounded-full overflow-hidden bg-primary/10"
            style={{ height: "72px", width: "72px" }}
          >
            {player.profile_icon_id ? (
              <Image
                src={getProfileIconUrl(player.profile_icon_id)}
                alt="Profile Icon"
                fill
                className="object-cover"
                sizes="72px"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <User className="h-9 w-9 text-primary" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle className="text-xl truncate">
                  {player.game_name}
                  {player.tag_line && `#${player.tag_line}`}
                </CardTitle>
                {league && (
                  <>
                    <span className={`font-semibold ${leagueColors?.text}`}>
                      {league.display_rank}
                    </span>
                    <Badge
                      className={`font-mono ${leagueColors?.badge} border-0`}
                    >
                      {league.league_points} LP
                    </Badge>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  className="button-small"
                  onClick={handleUpdate}
                  disabled={isUpdating}
                >
                  {isUpdating ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-1" />
                  )}
                  Update
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
              <span>{getPlatformDisplayName(player.platform)}</span>
              <span>•</span>
              <span>Level {player.summoner_level}</span>
              {stats && stats.total_matches > 0 && (
                <>
                  <span>•</span>
                  <span>Played {stats.total_matches} games</span>
                </>
              )}
              {player.is_tracked && (
                <>
                  <span>•</span>
                  <Badge
                    variant="default"
                    className="bg-primary text-xs cursor-pointer transition-all hover:bg-primary/100 flex items-center gap-1"
                    onClick={handleUntrack}
                    onMouseEnter={() => setIsHoveringTracked(true)}
                    onMouseLeave={() => setIsHoveringTracked(false)}
                  >
                    {isHoveringTracked ? (
                      <>
                        Untrack
                        <StarOff className="h-3 w-3" />
                      </>
                    ) : (
                      "Tracked"
                    )}
                  </Badge>
                </>
              )}
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
              <Clock className="h-3 w-3" />
              <span>Updated {formatRelativeTime(player.updated_at)}</span>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Win Rate Section (from league data, or from stats if no league) */}
        {league ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Trophy className="h-4 w-4 text-yellow-500" />
                <span className="text-sm font-medium">Win Rate</span>
              </div>
              <span
                className={`text-lg font-bold ${getWinRateColor(league.win_rate)}`}
              >
                {formatWinRate(league.win_rate)}%
              </span>
            </div>
            <div className="relative h-2 w-full bg-muted rounded-full overflow-hidden">
              <div
                className={`absolute left-0 top-0 h-full duration-300 ${getWinRateBarColor(league.win_rate)}`}
                style={{ width: `${Math.min(league.win_rate, 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{league.wins}W</span>
              <span>{league.losses}L</span>
            </div>
          </div>
        ) : stats && stats.total_matches > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Trophy className="h-4 w-4 text-yellow-500" />
                <span className="text-sm font-medium">Win Rate</span>
                <span className="text-xs text-muted-foreground">
                  (unranked)
                </span>
              </div>
              <span
                className={`text-lg font-bold ${getWinRateColor(stats.win_rate * 100)}`}
              >
                {formatWinRate(stats.win_rate)}%
              </span>
            </div>
            <div className="relative h-2 w-full bg-muted rounded-full overflow-hidden">
              <div
                className={`absolute left-0 top-0 h-full duration-300 ${getWinRateBarColor(stats.win_rate * 100)}`}
                style={{ width: `${Math.min(stats.win_rate * 100, 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{stats.wins}W</span>
              <span>{stats.losses}L</span>
            </div>
          </div>
        ) : null}

        {/* Analysis Timestamps */}
        <div className="grid grid-cols-3 gap-3 text-sm pt-1">
          <div>
            <p className="font-medium text-muted-foreground">
              Last Playstyle Analysis
            </p>
            <p>{formatDate(player.last_playstyle_analysis)}</p>
          </div>
          <div>
            <p className="font-medium text-muted-foreground">
              Last Matchmaking Analysis
            </p>
            <p>{formatDate(player.last_matchmaking_analysis)}</p>
          </div>
          <div>
            <p className="font-medium text-muted-foreground">
              Match History Updated
            </p>
            <p>{formatDate(player.updated_at)}</p>
          </div>
        </div>

        {/* Sample Statistics */}
        {stats && stats.total_matches > 0 && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center p-2 rounded-lg bg-muted/50">
                <p className="text-lg font-bold text-blue-500">
                  {stats.avg_kills.toFixed(1)}
                </p>
                <p className="text-xs text-muted-foreground">Avg Kills</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-muted/50">
                <p className="text-lg font-bold text-red-500">
                  {stats.avg_deaths.toFixed(1)}
                </p>
                <p className="text-xs text-muted-foreground">Avg Deaths</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-muted/50">
                <p className="text-lg font-bold text-green-500">
                  {stats.avg_assists.toFixed(1)}
                </p>
                <p className="text-xs text-muted-foreground">Avg Assists</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center p-2 rounded-lg bg-muted/50">
                <p className="text-lg font-bold">{stats.avg_kda.toFixed(2)}</p>
                <p className="text-xs text-muted-foreground">KDA</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-muted/50">
                <p className="text-lg font-bold">{stats.avg_cs.toFixed(0)}</p>
                <p className="text-xs text-muted-foreground">Avg CS</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-muted/50">
                <p className="text-lg font-bold">
                  {stats.avg_vision_score.toFixed(0)}
                </p>
                <p className="text-xs text-muted-foreground">Avg Vision</p>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
