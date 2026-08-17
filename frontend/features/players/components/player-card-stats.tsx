import type { MatchStatsResponse, Player } from "@/lib/core/schemas";

import { formatDate } from "./player-card-format";

interface PlayerCardStatsProps {
  player: Player;
  stats: MatchStatsResponse | null | undefined;
}

export function PlayerCardStats({ player, stats }: PlayerCardStatsProps) {
  return (
    <>
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
    </>
  );
}
