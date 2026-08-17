import { Trophy } from "lucide-react";

import type { MatchStatsResponse, PlayerLeague } from "@/lib/core/schemas";

import {
  formatWinRate,
  getWinRateBarColor,
  getWinRateColor,
} from "./player-card-format";

interface PlayerCardWinRateProps {
  league: PlayerLeague | null | undefined;
  stats: MatchStatsResponse | null | undefined;
}

export function PlayerCardWinRate({ league, stats }: PlayerCardWinRateProps) {
  if (league) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-yellow-500" />
            <span className="text-sm font-medium">Win Rate</span>
          </div>
          <span className={`text-lg font-bold ${getWinRateColor(league.win_rate)}`}>
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
    );
  }

  if (stats && stats.total_matches > 0) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-yellow-500" />
            <span className="text-sm font-medium">Win Rate</span>
            <span className="text-xs text-muted-foreground">(unranked)</span>
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
    );
  }

  return null;
}
