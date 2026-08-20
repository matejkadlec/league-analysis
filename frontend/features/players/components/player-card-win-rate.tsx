import { Trophy } from "lucide-react";

import type { MatchStatsResponse, PlayerLeague } from "@/lib/core/schemas";

import { formatFractionAsPercent, winRateColors } from "@/lib/core/format";

interface PlayerCardWinRateProps {
  league: PlayerLeague | null | undefined;
  stats: MatchStatsResponse | null | undefined;
  /**
   * Whether the ranked lookup failed, as opposed to answering "no league".
   *
   * Both arrive here as a falsy `league`, but only one of them licenses the
   * "(unranked)" label below: that word is a claim about the player, and a
   * failed request supports no claim at all. The toast reports the failure.
   */
  leagueFailed?: boolean;
}

export function PlayerCardWinRate({
  league,
  stats,
  leagueFailed = false,
}: PlayerCardWinRateProps) {
  if (league) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-yellow-500" />
            <span className="text-sm font-medium">Win Rate</span>
          </div>
          <span
            className={`text-lg font-bold ${winRateColors(league.win_rate).text}`}
          >
            {formatFractionAsPercent(league.win_rate)}
          </span>
        </div>
        <div className="relative h-2 w-full bg-muted rounded-full overflow-hidden">
          <div
            className={`absolute left-0 top-0 h-full duration-300 ${winRateColors(league.win_rate).bar}`}
            style={{ width: `${Math.min(league.win_rate, 1) * 100}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{league.wins}W</span>
          <span>{league.losses}L</span>
        </div>
      </div>
    );
  }

  if (!leagueFailed && stats && stats.total_matches > 0) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-yellow-500" />
            <span className="text-sm font-medium">Win Rate</span>
            <span className="text-xs text-muted-foreground">(unranked)</span>
          </div>
          <span
            className={`text-lg font-bold ${winRateColors(stats.win_rate).text}`}
          >
            {formatFractionAsPercent(stats.win_rate)}
          </span>
        </div>
        <div className="relative h-2 w-full bg-muted rounded-full overflow-hidden">
          <div
            className={`absolute left-0 top-0 h-full duration-300 ${winRateColors(stats.win_rate).bar}`}
            style={{ width: `${Math.min(stats.win_rate, 1) * 100}%` }}
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
