import {
  formatFractionAsPercent,
  formatKDA,
  kdaColor,
  winRateColors,
} from "@/lib/core/format";
import type { PerformanceStats } from "@/lib/core/schemas";

/**
 * The KDA and win-rate columns every stats grouping ends with.
 *
 * `performanceStatsFields` in the zod layer spells these seven numbers once so
 * a new metric cannot land on two of the three groupings; the renderer for
 * them had landed on two of the two, down to the `w-16` and the `{wins}W
 * {losses}L`. The one difference was the KDA line: `text-sm font-medium` on
 * the champion card, bare `text-sm` on the lane card. They agree here. The two
 * cards keep their own layout around this and share the figures themselves.
 */
export function PerformanceFigures({ stats }: { stats: PerformanceStats }) {
  return (
    <>
      <div className="text-right">
        <p className="text-sm font-medium">
          {stats.avg_kills.toFixed(1)} / {stats.avg_deaths.toFixed(1)} /{" "}
          {stats.avg_assists.toFixed(1)}
        </p>
        <p className="text-xs">
          <span className={kdaColor(stats.avg_kda)}>
            {formatKDA(stats.avg_kda)}
          </span>{" "}
          <span className="text-muted-foreground">KDA</span>
        </p>
      </div>

      <div className="text-right w-16">
        <p className={`text-sm font-bold ${winRateColors(stats.win_rate).text}`}>
          {formatFractionAsPercent(stats.win_rate)}
        </p>
        <p className="text-xs text-muted-foreground">
          {stats.wins}W {stats.losses}L
        </p>
      </div>
    </>
  );
}
