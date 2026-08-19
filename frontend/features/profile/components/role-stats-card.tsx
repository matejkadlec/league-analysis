"use client";

import Image from "next/image";
import { LaneStatsResponse } from "@/lib/core/schemas";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Map, Clock } from "lucide-react";
import { useRelativeTime } from "@/lib/core/use-relative-time";
import {
  formatFractionAsPercent,
  formatKDA,
  kdaColor,
  winRateColors,
} from "@/lib/core/format";

interface RoleStatsCardProps {
  stats: LaneStatsResponse;
  lastUpdated?: string | null | undefined;
}

// Get position icon path
function getPositionIconPath(lane: string): string {
  const iconMap: Record<string, string> = {
    Top: "/positions/position-top.svg",
    Jungle: "/positions/position-jungle.svg",
    Mid: "/positions/position-middle.svg",
    Bottom: "/positions/position-bottom.svg",
    Support: "/positions/position-utility.svg",
  };
  return iconMap[lane] || "/positions/position-middle.svg";
}

export function RoleStatsCard({ stats, lastUpdated }: RoleStatsCardProps) {
  const relativeUpdatedAt = useRelativeTime(lastUpdated);
  if (!stats.lanes || stats.lanes.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Map className="h-5 w-5 text-primary" />
            Role Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            Not enough match data to analyze role performance.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Calculate total games for percentage
  const totalGames = stats.lanes.reduce(
    (sum, lane) => sum + lane.games_played,
    0,
  );

  return (
    <Card id="role-performance">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Map className="h-5 w-5 text-primary" />
          Role Performance
        </CardTitle>
        {lastUpdated && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-2">
            <Clock className="h-3 w-3" />
            <span>Updated {relativeUpdatedAt}</span>
          </div>
        )}
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {stats.lanes.map((lane) => {
            const playRate =
              totalGames > 0 ? (lane.games_played / totalGames) * 100 : 0;

            return (
              <div key={lane.lane} className="flex gap-4">
                {/* Position Icon Column */}
                <div className="flex items-center justify-center w-12 shrink-0">
                  <Image
                    src={getPositionIconPath(lane.lane)}
                    alt={lane.lane}
                    width={40}
                    height={40}
                    className="opacity-80"
                  />
                </div>

                {/* Stats Column */}
                <div className="flex-1 space-y-2">
                  <div className="flex items-center justify-between">
                    {/* Lane name */}
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{lane.lane}</span>
                      <span className="text-sm text-muted-foreground">
                        ({lane.games_played} game
                        {lane.games_played !== 1 ? "s" : ""})
                      </span>
                    </div>

                    {/* Stats */}
                    <div className="flex items-center gap-4">
                      {/* KDA */}
                      <div className="text-right">
                        <p className="text-sm">
                          {lane.avg_kills.toFixed(1)} /{" "}
                          {lane.avg_deaths.toFixed(1)} /{" "}
                          {lane.avg_assists.toFixed(1)}
                        </p>
                        <p className="text-xs">
                          <span className={kdaColor(lane.avg_kda)}>
                            {formatKDA(lane.avg_kda)}
                          </span>{" "}
                          <span className="text-muted-foreground">KDA</span>
                        </p>
                      </div>

                      {/* Win rate */}
                      <div className="text-right w-16">
                        <p
                          className={`text-sm font-bold ${winRateColors(lane.win_rate).text}`}
                        >
                          {formatFractionAsPercent(lane.win_rate)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {lane.wins}W {lane.losses}L
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Play rate bar */}
                  <div className="relative h-2 w-full bg-muted rounded-full overflow-hidden">
                    <div
                      className={`absolute left-0 top-0 h-full ${winRateColors(lane.win_rate).bar} transition-all duration-300`}
                      style={{ width: `${playRate}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
