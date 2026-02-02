"use client";

import {
  Player,
  PlayerRankSchema,
  MatchStatsResponseSchema,
} from "@/lib/core/schemas";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { User, Trophy, RefreshCw, Loader2, Clock, StarOff } from "lucide-react";
import { TrackPlayerButton } from "./track-player-button";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { validatedGet, api, untrackPlayer } from "@/lib/core/api";
import { getPlatformDisplayName } from "@/lib/core/platform-utils";
import { toast } from "sonner";
import { useState } from "react";

interface PlayerCardProps {
  player: Player;
}

// Helper function to get win rate color based on percentage
function getWinRateColor(winRate: number): string {
  if (winRate >= 50.5) {
    return "text-emerald-500";
  } else if (winRate > 49) {
    return "text-amber-500";
  } else {
    return "text-rose-500";
  }
}

// Helper function to get win rate bar color based on percentage
function getWinRateBarColor(winRate: number): string {
  if (winRate >= 50.5) {
    return "bg-emerald-500";
  } else if (winRate > 49) {
    return "bg-amber-500";
  } else {
    return "bg-rose-500";
  }
}

// Format win rate - remove .0 if whole number
function formatWinRate(winRate: number): string {
  const formatted = winRate.toFixed(1);
  return formatted.endsWith(".0") ? Math.round(winRate).toString() : formatted;
}

// Helper function to get rank colors based on tier
function getRankColors(tier: string): {
  gradient: string;
  icon: string;
  text: string;
  badge: string;
} {
  const normalizedTier = tier.toUpperCase();

  switch (normalizedTier) {
    case "IRON":
      return {
        gradient: "from-gray-400/10 to-gray-500/10",
        icon: "text-gray-500 dark:text-gray-400",
        text: "text-gray-700 dark:text-gray-300",
        badge: "bg-gray-500/20 text-gray-700 dark:text-gray-300",
      };
    case "BRONZE":
      return {
        gradient: "from-orange-700/10 to-orange-800/10",
        icon: "text-orange-700 dark:text-orange-600",
        text: "text-orange-800 dark:text-orange-400",
        badge: "bg-orange-700/20 text-orange-800 dark:text-orange-400",
      };
    case "SILVER":
      return {
        gradient: "from-slate-400/10 to-slate-500/10",
        icon: "text-slate-500 dark:text-slate-400",
        text: "text-slate-700 dark:text-slate-300",
        badge: "bg-slate-500/20 text-slate-700 dark:text-slate-300",
      };
    case "GOLD":
      return {
        gradient: "from-yellow-500/10 to-amber-500/10",
        icon: "text-yellow-600 dark:text-yellow-500",
        text: "text-yellow-700 dark:text-yellow-400",
        badge: "bg-yellow-600/20 text-yellow-700 dark:text-yellow-400",
      };
    case "PLATINUM":
      return {
        gradient: "from-cyan-500/10 to-teal-500/10",
        icon: "text-cyan-600 dark:text-cyan-500",
        text: "text-cyan-700 dark:text-cyan-400",
        badge: "bg-cyan-600/20 text-cyan-700 dark:text-cyan-400",
      };
    case "EMERALD":
      return {
        gradient: "from-emerald-500/10 to-green-500/10",
        icon: "text-emerald-600 dark:text-emerald-500",
        text: "text-emerald-700 dark:text-emerald-400",
        badge: "bg-emerald-600/20 text-emerald-700 dark:text-emerald-400",
      };
    case "DIAMOND":
      return {
        gradient: "from-blue-500/10 to-indigo-500/10",
        icon: "text-blue-600 dark:text-blue-500",
        text: "text-blue-700 dark:text-blue-400",
        badge: "bg-blue-600/20 text-blue-700 dark:text-blue-400",
      };
    case "MASTER":
      return {
        gradient: "from-purple-500/10 to-fuchsia-500/10",
        icon: "text-purple-600 dark:text-purple-500",
        text: "text-purple-700 dark:text-purple-400",
        badge: "bg-purple-600/20 text-purple-700 dark:text-purple-400",
      };
    case "GRANDMASTER":
      return {
        gradient: "from-red-500/10 to-rose-500/10",
        icon: "text-red-600 dark:text-red-500",
        text: "text-red-700 dark:text-red-400",
        badge: "bg-red-600/20 text-red-700 dark:text-red-400",
      };
    case "CHALLENGER":
      return {
        gradient: "from-yellow-400/20 to-orange-500/20 via-red-500/20",
        icon: "text-yellow-500 dark:text-yellow-400",
        text: "text-transparent bg-clip-text bg-gradient-to-r from-yellow-500 via-red-500 to-orange-500",
        badge:
          "bg-gradient-to-r from-yellow-500/20 via-red-500/20 to-orange-500/20 text-yellow-600 dark:text-yellow-400 font-bold",
      };
    default:
      return {
        gradient: "from-gray-500/10 to-gray-600/10",
        icon: "text-gray-600 dark:text-gray-500",
        text: "text-gray-700 dark:text-gray-400",
        badge: "bg-gray-600/20 text-gray-700 dark:text-gray-400",
      };
  }
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

export function PlayerCard({ player }: PlayerCardProps) {
  const queryClient = useQueryClient();
  const [isUpdating, setIsUpdating] = useState(false);
  const [isHoveringTracked, setIsHoveringTracked] = useState(false);

  // Fetch player rank
  const { data: rank, refetch: refetchRank } = useQuery({
    queryKey: ["player-rank", player.puuid],
    queryFn: async () => {
      const result = await validatedGet(
        PlayerRankSchema.nullable(),
        `/players/${player.puuid}/rank`,
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

  // Handle update button click
  const handleUpdate = async () => {
    setIsUpdating(true);
    try {
      // Trigger a rank refresh from API
      await api.post(`/players/${player.puuid}/refresh-rank`);
      // Refetch all data
      await Promise.all([
        refetchRank(),
        refetchStats(),
        queryClient.invalidateQueries({ queryKey: ["player", player.puuid] }),
      ]);
      toast.success("Player data updated");
    } catch {
      toast.error("Failed to update player data");
    } finally {
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
      queryClient.invalidateQueries({ queryKey: ["tracked-players"] });
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

  const rankColors = rank ? getRankColors(rank.tier) : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        {/* First Part: Header Row */}
        <div className="flex items-center space-x-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <User className="h-6 w-6 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle className="text-xl truncate">
                  {player.game_name}
                  {player.tag_line && `#${player.tag_line}`}
                </CardTitle>
                {rank && (
                  <>
                    <span className={`font-semibold ${rankColors?.text}`}>
                      {rank.display_rank}
                    </span>
                    <Badge
                      className={`font-mono ${rankColors?.badge} border-0`}
                    >
                      {rank.league_points} LP
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
        {/* Win Rate Section (from rank data) */}
        {rank && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Trophy className="h-4 w-4 text-yellow-500" />
                <span className="text-sm font-medium">Win Rate</span>
              </div>
              <span
                className={`text-lg font-bold ${getWinRateColor(rank.win_rate)}`}
              >
                {formatWinRate(rank.win_rate)}%
              </span>
            </div>
            <div className="relative h-2 w-full bg-muted rounded-full overflow-hidden">
              <div
                className={`absolute left-0 top-0 h-full duration-300 ${getWinRateBarColor(rank.win_rate)}`}
                style={{ width: `${Math.min(rank.win_rate, 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{rank.wins}W</span>
              <span>{rank.losses}L</span>
            </div>
          </div>
        )}

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
