"use client";

import { useQuery } from "@tanstack/react-query";
import { playerStatsQueryOptions } from "@/features/players/player-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { ProfileCardEmptyState } from "./profile-card-empty-state";
import { UpdatedStamp } from "./updated-stamp";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Minus, Activity } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { formatFractionAsPercent, formatKDA } from "@/lib/core/format";

/** The comparison window the card labels "Last 10 games". */
const RECENT_GAME_COUNT = 10;

interface RecentPerformanceCardProps {
  puuid: string;
  lastUpdated?: string | null | undefined;
}

// Get a performance trend indicator.
//
// `threshold` defaults to 5% of the overall value, which is what raw stats
// want -- CS is counted in the hundreds and a fixed number cannot serve both
// it and a win rate. Fractions already on a 0-1 scale pass their own band.
//
// `higherIsBetter` has no default on purpose. Every stat on this card except
// deaths wants `true`, which makes a default the obviously convenient choice
// and exactly the wrong one: the single call that needs `false` is the one a
// silent default would get wrong, and getting it wrong tells a player who is
// dying less that they are declining. Requiring the argument makes each call
// site say which direction it means.
function getTrendIndicator(
  recent: number,
  overall: number,
  higherIsBetter: boolean,
  threshold = overall * 0.05,
): { icon: React.ReactNode; color: string; label: string } {
  const diff = recent - overall;

  const isImproving = higherIsBetter ? diff > threshold : diff < -threshold;
  const isDeclining = higherIsBetter ? diff < -threshold : diff > threshold;

  if (isImproving) {
    return {
      icon: <TrendingUp className="h-4 w-4" />,
      color: "text-emerald-500",
      label: "improving",
    };
  } else if (isDeclining) {
    return {
      icon: <TrendingDown className="h-4 w-4" />,
      color: "text-rose-500",
      label: "declining",
    };
  }
  return {
    icon: <Minus className="h-4 w-4" />,
    color: "text-muted-foreground",
    label: "stable",
  };
}

// One decimal at most; Intl drops a trailing ".0" natively, so the
// hand-rolled strip this replaced is gone. Grouping off keeps the swap
// exact if a four-digit stat ever lands here (no "1,234.6").
const oneDecimalFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  useGrouping: false,
});

function formatNumber(value: number): string {
  return oneDecimalFormatter.format(value);
}

// Stat comparison row. `small` is the 75%-size variant the 3-column row wants;
// nothing but the size tokens differs between the two.
function StatComparisonRow({
  label,
  recentValue,
  overallValue,
  trend,
  small = false,
}: {
  label: string;
  recentValue: string;
  overallValue: string;
  trend: { icon: React.ReactNode; color: string; label: string };
  small?: boolean;
}) {
  const value = small ? "text-xl" : "text-2xl";
  const caption = small ? "text-[10px]" : "text-xs";
  return (
    <div className={small ? "space-y-1" : "space-y-2"}>
      <h4
        className={`${small ? "text-xs" : "text-sm"} font-medium text-muted-foreground`}
      >
        {label}
      </h4>
      <div className="flex items-center justify-between">
        <div>
          <p className={`${value} font-bold`}>{recentValue}</p>
          <p className={`${caption} text-muted-foreground`}>Recent</p>
        </div>
        <div
          className={`flex items-center ${small ? "gap-0.5" : "gap-1"} ${trend.color}`}
        >
          {trend.icon}
          <span className={`${small ? "text-xs" : "text-sm"} capitalize`}>
            {trend.label}
          </span>
        </div>
        <div className="text-right">
          <p className={`${value} font-bold text-muted-foreground`}>
            {overallValue}
          </p>
          <p className={`${caption} text-muted-foreground`}>Overall</p>
        </div>
      </div>
    </div>
  );
}

export function RecentPerformanceCard({
  puuid,
  lastUpdated,
}: RecentPerformanceCardProps) {
  // Fetch recent stats (last 10 games for comparison)
  const { data: recent = null, isLoading: isRecentLoading } = useQuery(
    playerStatsQueryOptions(puuid, RECENT_GAME_COUNT),
  );

  // Fetch overall stats (all games)
  const { data: overall = null, isLoading: isOverallLoading } = useQuery(
    playerStatsQueryOptions(puuid),
  );

  const isLoading = isRecentLoading || isOverallLoading;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!recent || !overall || overall.total_matches === 0) {
    return (
      <ProfileCardEmptyState
        icon={Activity}
        title="Recent Performance"
        message="Not enough match data to analyze performance trends."
      />
    );
  }

  // Calculate trends
  const winRateTrend = getTrendIndicator(
    recent.win_rate,
    overall.win_rate,
    true,
    0.05,
  );
  const kdaTrend = getTrendIndicator(recent.avg_kda, overall.avg_kda, true);
  const killsTrend = getTrendIndicator(
    recent.avg_kills,
    overall.avg_kills,
    true,
  );
  const csTrend = getTrendIndicator(recent.avg_cs, overall.avg_cs, true);
  const deathsTrend = getTrendIndicator(
    recent.avg_deaths,
    overall.avg_deaths,
    false,
  );
  const visionTrend = getTrendIndicator(
    recent.avg_vision_score,
    overall.avg_vision_score,
    true,
  );
  const assistsTrend = getTrendIndicator(
    recent.avg_assists,
    overall.avg_assists,
    true,
  );

  return (
    <Card id="recent-performance">
      <CardHeader className="pb-3">
        <div className="flex gap-2">
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            Recent Performance
          </CardTitle>
          <Badge variant="secondary" className="ml-auto">
            Recent 10 games in comparison with overall performance (
            {overall.total_matches} games)
          </Badge>
        </div>
        <UpdatedStamp
          lastUpdated={lastUpdated}
          className="text-xs text-muted-foreground mt-2"
        />
      </CardHeader>
      <CardContent>
        {/* Row 1: Win Rate | KDA */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <StatComparisonRow
            label="Win Rate"
            recentValue={formatFractionAsPercent(recent.win_rate)}
            overallValue={formatFractionAsPercent(overall.win_rate)}
            trend={winRateTrend}
          />

          <StatComparisonRow
            label="KDA"
            recentValue={formatKDA(recent.avg_kda)}
            overallValue={formatKDA(overall.avg_kda)}
            trend={kdaTrend}
          />
        </div>

        <Separator className="my-4 bg-gradient-to-r from-transparent via-gray-300 to-transparent" />

        {/* Row 2: Avg Kills | Avg Deaths | Avg Assists (smaller) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 my-4.5">
          <StatComparisonRow
            small
            label="Avg Kills"
            recentValue={formatNumber(recent.avg_kills)}
            overallValue={formatNumber(overall.avg_kills)}
            trend={killsTrend}
          />
          <StatComparisonRow
            small
            label="Avg Deaths"
            recentValue={formatNumber(recent.avg_deaths)}
            overallValue={formatNumber(overall.avg_deaths)}
            trend={deathsTrend}
          />
          <StatComparisonRow
            small
            label="Avg Assists"
            recentValue={formatNumber(recent.avg_assists)}
            overallValue={formatNumber(overall.avg_assists)}
            trend={assistsTrend}
          />
        </div>

        <Separator className="my-4 bg-gradient-to-r from-transparent via-gray-300 to-transparent" />

        {/* Row 3: Avg CS | Avg Vision */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
          <StatComparisonRow
            label="Avg CS"
            recentValue={formatNumber(recent.avg_cs)}
            overallValue={formatNumber(overall.avg_cs)}
            trend={csTrend}
          />
          <StatComparisonRow
            label="Avg Vision"
            recentValue={formatNumber(recent.avg_vision_score)}
            overallValue={formatNumber(overall.avg_vision_score)}
            trend={visionTrend}
          />
        </div>
      </CardContent>
    </Card>
  );
}
