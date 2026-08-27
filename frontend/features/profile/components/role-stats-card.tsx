"use client";

import Image from "next/image";
import { LaneStatsResponse } from "@/lib/core/schemas";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { ProfileCardEmptyState } from "./profile-card-empty-state";
import { UpdatedStamp } from "./updated-stamp";
import { Map } from "lucide-react";
import { winRateColors } from "@/lib/core/format";
import { cn } from "@/lib/core/utils";
import { PerformanceFigures } from "./performance-figures";

interface RoleStatsCardProps {
  stats: LaneStatsResponse;
  lastUpdated?: string | null | undefined;
}

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
  if (stats.lanes.length === 0) {
    return (
      <ProfileCardEmptyState
        id="role-performance"
        icon={Map}
        title="Role Performance"
        message="Not enough match data to analyze role performance."
      />
    );
  }

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
        <UpdatedStamp
          lastUpdated={lastUpdated}
          className="text-xs text-muted-foreground mt-2"
        />
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {stats.lanes.map((lane) => {
            const playRate =
              totalGames > 0 ? (lane.games_played / totalGames) * 100 : 0;

            return (
              <div key={lane.lane} className="flex gap-4">
                <div className="flex items-center justify-center w-12 shrink-0">
                  <Image
                    src={getPositionIconPath(lane.lane)}
                    alt={lane.lane}
                    width={40}
                    height={40}
                    className="opacity-80"
                  />
                </div>

                <div className="flex-1 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{lane.lane}</span>
                      <span className="text-sm text-muted-foreground">
                        ({lane.games_played} game
                        {lane.games_played !== 1 ? "s" : ""})
                      </span>
                    </div>

                    <div className="flex items-center gap-4">
                      <PerformanceFigures stats={lane} />
                    </div>
                  </div>

                  <div className="relative h-2 w-full bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn(
                        "absolute left-0 top-0 h-full",
                        winRateColors(lane.win_rate).bar,
                        "transition-all duration-300",
                      )}
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
