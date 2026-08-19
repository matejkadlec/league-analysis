"use client";

import { useQuery } from "@tanstack/react-query";
import { MatchStatsResponseSchema } from "@/lib/core/schemas";
import { unwrap, validatedGet } from "@/lib/core/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Minus, Activity, Clock } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { useRelativeTime } from "@/lib/core/use-relative-time";
import { formatFractionAsPercent } from "@/lib/core/format";

interface RecentPerformanceCardProps {
  puuid: string;
  lastUpdated?: string | null | undefined;
}

// Helper function to get performance trend indicator
function getTrendIndicator(
  recent: number,
  overall: number,
): { icon: React.ReactNode; color: string; label: string } {
  const diff = recent - overall;
  const threshold = 0.05; // 5% threshold for "significant" change

  if (diff > threshold) {
    return {
      icon: <TrendingUp className="h-4 w-4" />,
      color: "text-emerald-500",
      label: "improving",
    };
  } else if (diff < -threshold) {
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

// Get trend indicator for raw values (not percentages).
//
// `higherIsBetter` has no default on purpose. Every stat on this card except
// deaths wants `true`, which makes a default the obviously convenient choice
// and exactly the wrong one: the single call that needs `false` is the one a
// silent default would get wrong, and getting it wrong tells a player who is
// dying less that they are declining. Requiring the argument makes each call
// site say which direction it means.
function getTrendIndicatorRaw(
  recent: number,
  overall: number,
  higherIsBetter: boolean,
): { icon: React.ReactNode; color: string; label: string } {
  const threshold = overall * 0.05; // 5% of overall value
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

// Format percentage
// Format number with 1 decimal (remove .0 if whole)
function formatNumber(value: number): string {
  const formatted = value.toFixed(1);
  return formatted.endsWith(".0") ? Math.round(value).toString() : formatted;
}

// Stat comparison row component
function StatComparisonRow({
  label,
  recentValue,
  overallValue,
  trend,
}: {
  label: string;
  recentValue: string;
  overallValue: string;
  trend: { icon: React.ReactNode; color: string; label: string };
}) {
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-muted-foreground">{label}</h4>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-2xl font-bold">{recentValue}</p>
          <p className="text-xs text-muted-foreground">Recent</p>
        </div>
        <div className={`flex items-center gap-1 ${trend.color}`}>
          {trend.icon}
          <span className="text-sm capitalize">{trend.label}</span>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-muted-foreground">
            {overallValue}
          </p>
          <p className="text-xs text-muted-foreground">Overall</p>
        </div>
      </div>
    </div>
  );
}

// Smaller stat comparison row for 3-column layout (75% size)
function SmallStatComparisonRow({
  label,
  recentValue,
  overallValue,
  trend,
}: {
  label: string;
  recentValue: string;
  overallValue: string;
  trend: { icon: React.ReactNode; color: string; label: string };
}) {
  return (
    <div className="space-y-1">
      <h4 className="text-xs font-medium text-muted-foreground">{label}</h4>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xl font-bold">{recentValue}</p>
          <p className="text-[10px] text-muted-foreground">Recent</p>
        </div>
        <div className={`flex items-center gap-0.5 ${trend.color}`}>
          {trend.icon}
          <span className="text-xs capitalize">{trend.label}</span>
        </div>
        <div className="text-right">
          <p className="text-xl font-bold text-muted-foreground">
            {overallValue}
          </p>
          <p className="text-[10px] text-muted-foreground">Overall</p>
        </div>
      </div>
    </div>
  );
}

export function RecentPerformanceCard({
  puuid,
  lastUpdated,
}: RecentPerformanceCardProps) {
  const relativeUpdatedAt = useRelativeTime(lastUpdated);
  // Fetch recent stats (last 10 games for comparison)
  const { data: recent = null, isLoading: isRecentLoading } = useQuery({
    queryKey: ["recent-stats", puuid, 10],
    queryFn: async () =>
      unwrap(
        await validatedGet(
          MatchStatsResponseSchema,
          `/matches/player/${puuid}/stats`,
          { queue: 420, limit: 10 },
        ),
      ),
  });

  // Fetch overall stats (all games)
  const { data: overall = null, isLoading: isOverallLoading } = useQuery({
    queryKey: ["overall-stats", puuid],
    queryFn: async () =>
      unwrap(
        await validatedGet(
          MatchStatsResponseSchema,
          `/matches/player/${puuid}/stats`,
          { queue: 420 },
        ),
      ),
  });

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
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            Recent Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            Not enough match data to analyze performance trends.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Calculate trends
  const winRateTrend = getTrendIndicator(recent.win_rate, overall.win_rate);
  const kdaTrend = getTrendIndicatorRaw(recent.avg_kda, overall.avg_kda, true);
  const killsTrend = getTrendIndicatorRaw(
    recent.avg_kills,
    overall.avg_kills,
    true,
  );
  const csTrend = getTrendIndicatorRaw(recent.avg_cs, overall.avg_cs, true);
  const deathsTrend = getTrendIndicatorRaw(
    recent.avg_deaths,
    overall.avg_deaths,
    false,
  );
  const visionTrend = getTrendIndicatorRaw(
    recent.avg_vision_score,
    overall.avg_vision_score,
    true,
  );
  const assistsTrend = getTrendIndicatorRaw(
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
        {lastUpdated && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-2">
            <Clock className="h-3 w-3" />
            <span>Updated {relativeUpdatedAt}</span>
          </div>
        )}
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
            recentValue={recent.avg_kda.toFixed(2)}
            overallValue={overall.avg_kda.toFixed(2)}
            trend={kdaTrend}
          />
        </div>

        <Separator className="my-4 bg-gradient-to-r from-transparent via-gray-300 to-transparent" />

        {/* Row 2: Avg Kills | Avg Deaths | Avg Assists (smaller) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 my-4.5">
          <SmallStatComparisonRow
            label="Avg Kills"
            recentValue={formatNumber(recent.avg_kills)}
            overallValue={formatNumber(overall.avg_kills)}
            trend={killsTrend}
          />
          <SmallStatComparisonRow
            label="Avg Deaths"
            recentValue={formatNumber(recent.avg_deaths)}
            overallValue={formatNumber(overall.avg_deaths)}
            trend={deathsTrend}
          />
          <SmallStatComparisonRow
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
