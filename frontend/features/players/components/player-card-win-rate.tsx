import { Trophy } from "lucide-react";

import type { MatchStatsResponse, PlayerLeague } from "@/lib/core/schemas";

import { formatFractionAsPercent, winRateColors } from "@/lib/core/format";
import { cn } from "@/lib/core/utils";

interface PlayerCardWinRateProps {
  league: PlayerLeague | null | undefined;
  stats: MatchStatsResponse | null | undefined;
  /**
   * Whether the ranked lookup failed, as opposed to answering "no league".
   * Both arrive as a falsy `league`, but only one licenses the "(unranked)"
   * label: that word is a claim about the player and a failed request
   * supports no claim. The toast reports the failure.
   */
  leagueFailed?: boolean;
}

export function PlayerCardWinRate({
  league,
  stats,
  leagueFailed = false,
}: PlayerCardWinRateProps) {
  const source =
    league ??
    (!leagueFailed && stats && stats.total_matches > 0 ? stats : null);
  if (!source) return null;

  const colors = winRateColors(source.win_rate);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-yellow-500" />
          <span className="text-sm font-medium">Win Rate</span>
          {!league && (
            <span className="text-xs text-muted-foreground">(unranked)</span>
          )}
        </div>
        <span className={cn("text-lg font-bold", colors.text)}>
          {formatFractionAsPercent(source.win_rate)}
        </span>
      </div>
      <div className="relative h-2 w-full bg-muted rounded-full overflow-hidden">
        <div
          className={cn("absolute left-0 top-0 h-full duration-300", colors.bar)}
          style={{ width: `${Math.min(source.win_rate, 1) * 100}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{source.wins}W</span>
        <span>{source.losses}L</span>
      </div>
    </div>
  );
}
