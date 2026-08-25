import {
  formatFractionAsPercent,
  formatKDA,
  kdaColor,
  winRateColors,
} from "@/lib/core/format";
import type { PerformanceStats } from "@/lib/core/schemas";
import { cn } from "@/lib/core/utils";

/**
 * The KDA and win-rate columns every stats grouping ends with. The two
 * renderers had converged down to the `w-16` and the `{wins}W {losses}L`,
 * differing only in `font-medium` on the KDA line; they agree here. Each card
 * keeps its own layout around this and shares the figures themselves.
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
        <p className={cn("text-sm font-bold", winRateColors(stats.win_rate).text)}>
          {formatFractionAsPercent(stats.win_rate)}
        </p>
        <p className="text-xs text-muted-foreground">
          {stats.wins}W {stats.losses}L
        </p>
      </div>
    </>
  );
}
