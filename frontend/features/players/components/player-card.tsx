"use client";

import Image from "next/image";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock, Loader2, RefreshCw, User } from "lucide-react";

import { validatedGet } from "@/lib/core/api";
import { useDDragonVersion } from "@/lib/core/data-dragon-context";
import {
  getProfileIconFallbackUrl,
  getProfileIconUrl,
} from "@/lib/core/data-dragon";
import { getPlatformDisplayName } from "@/lib/core/platform-utils";
import { oldestCompleteFreshness } from "@/lib/core/relative-time";
import {
  MatchStatsResponseSchema,
  Player,
  PlayerLeagueSchema,
} from "@/lib/core/schemas";
import { useRelativeTime } from "@/lib/core/use-relative-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getRankColors } from "@/features/players/utils/rank-colors";
import { TrackPlayerButton } from "@/features/players/components/track-player-button";
import { usePlayerSyncRun } from "@/features/players/use-player-sync-run";

import { PlayerCardStats } from "./player-card-stats";
import { PlayerCardWinRate } from "./player-card-win-rate";

interface PlayerCardProps {
  player: Player;
  onRefreshAll?: () => void;
}

export function PlayerCard({ player, onRefreshAll }: PlayerCardProps) {
  const ddragonVersion = useDDragonVersion();
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
  const { isUpdating, startSync } = usePlayerSyncRun(player.puuid, {
    onCompleted: onRefreshAll,
  });

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

  const leagueColors = league ? getRankColors(league.tier) : null;

  return (
    <Card id="player-summary">
      <CardHeader className="pb-3">
        <div className="flex items-center space-x-3">
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
              {/* `min-w-0` is what lets the truncating title actually shrink:
                  a flex item defaults to `min-width: auto`, so without it a
                  long Riot ID pushes the controls past a phone's viewport. */}
              <div className="flex min-w-0 flex-wrap items-center gap-2">
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
                  onClick={startSync}
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
        <PlayerCardWinRate league={league} stats={stats} />
        <PlayerCardStats player={player} stats={stats} />
      </CardContent>
    </Card>
  );
}
