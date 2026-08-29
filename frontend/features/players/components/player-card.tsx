"use client";

import Image from "next/image";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock, Loader2, RefreshCw } from "lucide-react";

import { useDDragonVersion } from "@/lib/core/riot/data-dragon-context";
import {
  getProfileIconFallbackUrl,
  getProfileIconUrl,
} from "@/lib/core/riot/data-dragon";
import { getPlatformDisplayName } from "@/lib/core/riot/platform-utils";
import { oldestCompleteFreshness } from "@/lib/core/relative-time";
import { Player } from "@/lib/core/schemas";
import { useRelativeTime } from "@/lib/core/hooks/use-relative-time";
import { playerStatsQueryOptions } from "../player-query";
import { cn } from "@/lib/core/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getRankColors } from "../rank-colors";
import { TrackPlayerButton } from "../components/track-player-button";
import { usePlayerLeague } from "./use-player-league";
import { usePlayerSyncRun } from "./use-player-sync-run";

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
  const profileIconKey = `${player.puuid}:${player.profile_icon_id}`;
  const hasFailedProfileIcon = failedProfileIconKey === profileIconKey;
  const profileIconSrc = hasFailedProfileIcon
    ? getProfileIconFallbackUrl(ddragonVersion)
    : getProfileIconUrl(player.profile_icon_id, ddragonVersion);
  const { isUpdating, startSync } = usePlayerSyncRun(player.puuid, {
    onCompleted: onRefreshAll,
  });

  const { data: league, isError: leagueFailed } = usePlayerLeague(
    player.puuid,
  );

  const { data: stats } = useQuery(playerStatsQueryOptions(player.puuid));

  const leagueColors = league ? getRankColors(league.tier) : null;

  return (
    <Card id="player-summary">
      <CardHeader className="pb-3">
        <div className="flex items-center space-x-3">
          <div
            className="relative h-18 w-18 rounded-full overflow-hidden bg-primary/10"
            style={{ height: "72px", width: "72px" }}
          >
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
                    <span className={cn("font-semibold", leagueColors?.text)}>
                      {league.display_rank}
                    </span>
                    <Badge
                      className={cn("font-mono", leagueColors?.badge, "border-0")}
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
                playerName={player.game_name}
                isTracked={player.is_tracked}
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
        <PlayerCardWinRate
          league={league}
          stats={stats}
          leagueFailed={leagueFailed}
        />
        <PlayerCardStats player={player} stats={stats} />
      </CardContent>
    </Card>
  );
}
