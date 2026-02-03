"use client";

import Image from "next/image";
import { ChampionStatsResponse } from "@/lib/core/schemas";
import { getChampionIconUrl } from "@/lib/core/data-dragon";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Swords, Clock } from "lucide-react";

interface ChampionStatsCardProps {
  stats: ChampionStatsResponse;
  lastUpdated?: string | null;
}

// Format relative time
function formatRelativeTime(dateString: string | null | undefined): string {
  if (!dateString) return "Never";

  const now = new Date();
  const date = new Date(dateString);
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return "just now";
  if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? "s" : ""} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;

  return new Date(dateString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// Helper function to get win rate color
function getWinRateColor(winRate: number): string {
  const winRatePercent = winRate * 100;
  if (winRatePercent >= 51) return "text-green-500";
  if (winRatePercent > 49) return "text-yellow-500";
  return "text-rose-500";
}

// Helper function to get KDA color
function getKDAColor(kda: number): string {
  if (kda >= 3) return "text-green-500";
  if (kda >= 2) return "text-yellow-500";
  return "text-rose-500";
}

// Format win rate percentage
function formatWinRate(winRate: number): string {
  const percent = winRate * 100;
  return percent % 1 === 0
    ? `${percent.toFixed(0)}%`
    : `${percent.toFixed(1)}%`;
}

// Format KDA
function formatKDA(kda: number): string {
  return kda.toFixed(2);
}

export function ChampionStatsCard({
  stats,
  lastUpdated,
}: ChampionStatsCardProps) {
  if (!stats.champions || stats.champions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Swords className="h-5 w-5 text-primary" />
            Top Champions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            No champion data available. Play some ranked games to see your
            statistics here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card id="top-champions">
      <CardHeader className="pb-3">
        <CardTitle className="flex gap-2">
          <Swords className="h-5 w-5 text-primary" />
          Top Champions
          <Badge variant="secondary" className="ml-auto">
            Top 5 champions played ({stats.total_champions} different champions
            played in total)
          </Badge>
        </CardTitle>
        {lastUpdated && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-2">
            <Clock className="h-3 w-3" />
            <span>Updated {formatRelativeTime(lastUpdated)}</span>
          </div>
        )}
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {stats.champions.slice(0, 5).map((champ, index) => (
            <div
              key={champ.champion_name}
              className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
            >
              {/* Rank number */}
              <span className="text-sm font-medium text-muted-foreground w-4">
                {index + 1}
              </span>

              {/* Champion icon */}
              <div className="relative h-10 w-10 rounded-full overflow-hidden border-2 border-primary/20">
                <Image
                  src={getChampionIconUrl(champ.champion_name)}
                  alt={champ.champion_name}
                  fill
                  className="object-cover"
                  sizes="40px"
                />
              </div>

              {/* Champion name and games */}
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{champ.champion_name}</p>
                <p className="text-xs text-muted-foreground">
                  {champ.games_played} game{champ.games_played !== 1 ? "s" : ""}
                </p>
              </div>

              {/* KDA */}
              <div className="text-right">
                <p className="text-sm font-medium">
                  {champ.avg_kills.toFixed(1)} / {champ.avg_deaths.toFixed(1)} /{" "}
                  {champ.avg_assists.toFixed(1)}
                </p>
                <p className="text-xs">
                  <span className={getKDAColor(champ.avg_kda)}>
                    {formatKDA(champ.avg_kda)}
                  </span>{" "}
                  <span className="text-muted-foreground">KDA</span>
                </p>
              </div>

              {/* Win rate */}
              <div className="text-right w-16">
                <p
                  className={`text-sm font-bold ${getWinRateColor(champ.win_rate)}`}
                >
                  {formatWinRate(champ.win_rate)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {champ.wins}W {champ.losses}L
                </p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
