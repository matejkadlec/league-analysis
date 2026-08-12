"use client";

import Image from "next/image";
import {
  Player,
  PlayerLeagueSchema,
  MatchStatsResponseSchema,
  PlayerSyncRunSchema,
} from "@/lib/core/schemas";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { User, Trophy, RefreshCw, Loader2, Clock } from "lucide-react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { validatedGet, api } from "@/lib/core/api";
import { getPlatformDisplayName } from "@/lib/core/platform-utils";
import {
  getProfileIconUrl,
  getProfileIconFallbackUrl,
} from "@/lib/core/data-dragon";
import { useDDragonVersion } from "@/lib/core/data-dragon-context";
import { useEffect, useRef, useState } from "react";
import { getRankColors } from "@/features/players/utils/rank-colors";
import { TrackPlayerButton } from "@/features/players/components/track-player-button";
import { useToast } from "@/lib/core/hooks";
import { oldestCompleteFreshness } from "@/lib/core/relative-time";
import { useRelativeTime } from "@/lib/core/use-relative-time";

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

export function PlayerCard({ player, onRefreshAll }: PlayerCardProps) {
  const ddragonVersion = useDDragonVersion();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [observedSyncId, setObservedSyncId] = useState<number | null>(null);
  const handledTerminalSyncIds = useRef(new Set<number>());
  const [failedProfileIconKey, setFailedProfileIconKey] = useState<
    string | null
  >(null);
  const combinedFreshness = oldestCompleteFreshness([
    player.profile_synced_at,
    player.league_synced_at,
    player.match_synced_at,
  ]);
  const relativeFreshness = useRelativeTime(combinedFreshness);
  const profileIconId =
    typeof player.profile_icon_id === "number" ? player.profile_icon_id : 29;
  const profileIconKey = `${player.puuid}:${profileIconId}`;
  const hasFailedProfileIcon = failedProfileIconKey === profileIconKey;
  const profileIconSrc = hasFailedProfileIcon
    ? getProfileIconFallbackUrl(profileIconId, ddragonVersion)
    : getProfileIconUrl(profileIconId, ddragonVersion);

  // Fetch player league
  const { data: league } = useQuery({
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
  const { data: stats } = useQuery({
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

  const activeSyncQuery = useQuery({
    queryKey: ["player-sync-active", player.puuid],
    queryFn: async () => {
      const result = await validatedGet(
        PlayerSyncRunSchema.nullable(),
        `/players/${player.puuid}/sync/active`,
      );
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    refetchInterval: (query) => (query.state.data ? 1_000 : false),
  });

  useEffect(() => {
    const activeSyncId = activeSyncQuery.data?.id;
    if (!activeSyncId || activeSyncId === observedSyncId) return;
    const timeout = window.setTimeout(() => setObservedSyncId(activeSyncId), 0);
    return () => window.clearTimeout(timeout);
  }, [activeSyncQuery.data?.id, observedSyncId]);

  const exactSyncQuery = useQuery({
    queryKey: ["player-sync", player.puuid, observedSyncId],
    queryFn: async () => {
      const result = await validatedGet(
        PlayerSyncRunSchema,
        `/players/${player.puuid}/sync/${observedSyncId}`,
      );
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    enabled: observedSyncId !== null,
    refetchInterval: (query) =>
      query.state.data?.status === "pending" ||
      query.state.data?.status === "running"
        ? 1_000
        : false,
  });

  const startSyncMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post(`/players/${player.puuid}/sync`);
      const parsed = PlayerSyncRunSchema.safeParse(response.data);
      if (!parsed.success) throw new Error("The update response was invalid.");
      return parsed.data;
    },
    onSuccess: (syncRun) => {
      setObservedSyncId(syncRun.id);
      queryClient.setQueryData(["player-sync-active", player.puuid], syncRun);
      toast({
        title: "Player profile update started",
        description: "Player data is refreshing in the background.",
        variant: "info",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to start player update",
        description: error.message,
        variant: "error",
      });
    },
  });

  useEffect(() => {
    const syncRun = exactSyncQuery.data;
    if (
      !syncRun ||
      syncRun.status === "pending" ||
      syncRun.status === "running" ||
      handledTerminalSyncIds.current.has(syncRun.id)
    ) {
      return;
    }
    handledTerminalSyncIds.current.add(syncRun.id);

    const finish = async () => {
      if (syncRun.status !== "completed") {
        toast({
          title: "Player update did not finish",
          description:
            syncRun.error_message ?? "Please try the update again later.",
          variant: syncRun.status === "rate_limited" ? "warning" : "error",
        });
        await activeSyncQuery.refetch();
        return;
      }

      const exactPlayerQuery = (query: { queryKey: readonly unknown[] }) =>
        query.queryKey.includes(player.puuid);
      try {
        await queryClient.invalidateQueries({
          predicate: exactPlayerQuery,
          refetchType: "none",
        });
        onRefreshAll?.();
        await queryClient.refetchQueries(
          { predicate: exactPlayerQuery, type: "active" },
          { throwOnError: true },
        );
        toast({
          title: "Update finished",
          description: "All cards were successfully updated.",
          variant: "info",
        });
      } catch {
        toast({
          title: "Player data could not refresh",
          description: "Please try again before relying on the card data.",
          variant: "error",
        });
      }
      await activeSyncQuery.refetch();
    };
    void finish();
  }, [
    activeSyncQuery,
    exactSyncQuery.data,
    onRefreshAll,
    player.puuid,
    queryClient,
    toast,
  ]);

  const syncStatus =
    exactSyncQuery.data?.status ?? activeSyncQuery.data?.status;
  const isUpdating =
    startSyncMutation.isPending ||
    syncStatus === "pending" ||
    syncStatus === "running";

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
                key={profileIconKey}
                src={profileIconSrc}
                alt="Profile Icon"
                fill
                className="object-cover"
                sizes="72px"
                onError={() => {
                  setFailedProfileIconKey(profileIconKey);
                }}
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
                  onClick={() => startSyncMutation.mutate()}
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
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>{getPlatformDisplayName(player.platform)}</span>
              <span>•</span>
              <span>Level {player.summoner_level}</span>
              {stats && stats.total_matches > 0 && (
                <>
                  <span>•</span>
                  <span>Played {stats.total_matches} games</span>
                </>
              )}
              <span>•</span>
              <TrackPlayerButton
                puuid={player.puuid}
                playerName={player.game_name ?? undefined}
                variant="ghost"
                size="sm"
              />
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
              <Clock className="h-3 w-3" />
              <span>
                {combinedFreshness
                  ? `Updated ${relativeFreshness}`
                  : "Not fully synced yet"}
              </span>
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
        <div className="grid grid-cols-2 gap-3 pt-1 text-sm">
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
            <p>{formatDate(player.match_synced_at)}</p>
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
                <p className="text-xs text-muted-foreground">Avg KDA</p>
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
