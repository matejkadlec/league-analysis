import { Trophy } from "lucide-react";

import type { MatchStatsResponse, PlayerLeague } from "@/lib/core/schemas";

import {
  formatFractionAsPercent,
  winRateBarColor,
  winRateTextColor,
} from "@/lib/core/format";

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
          {/* league.win_rate is the one percent-shaped source (0-100); the
              shared helpers take a 0-1 fraction, so it converts here, once,
              where the unit is known. */}
          <span
            className={`text-lg font-bold ${winRateTextColor(league.win_rate / 100)}`}
          >
            {formatFractionAsPercent(league.win_rate / 100)}
          </span>
        </div>
        <div className="relative h-2 w-full bg-muted rounded-full overflow-hidden">
          <div
            className={`absolute left-0 top-0 h-full duration-300 ${winRateBarColor(league.win_rate / 100)}`}
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
            className={`text-lg font-bold ${winRateTextColor(stats.win_rate)}`}
          >
            {formatFractionAsPercent(stats.win_rate)}
          </span>
        </div>
        <div className="relative h-2 w-full bg-muted rounded-full overflow-hidden">
          <div
            className={`absolute left-0 top-0 h-full duration-300 ${winRateBarColor(stats.win_rate)}`}
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
