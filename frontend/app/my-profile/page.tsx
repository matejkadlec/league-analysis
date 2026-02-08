"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth, ProtectedRoute } from "@/features/auth";
import {
  PlayerSchema,
  ChampionStatsResponseSchema,
  LaneStatsResponseSchema,
} from "@/lib/core/schemas";
import { validatedGet } from "@/lib/core/api";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Link2 } from "lucide-react";
import { PlayerCard } from "@/features/players";
import { MatchHistory } from "@/features/matches";
import {
  ChampionStatsCard,
  RoleStatsCard,
  RecentPerformanceCard,
  ConnectRiotAccountDialog,
} from "@/features/profile";
import {
  PlayerCardSkeleton,
  MatchHistorySkeleton,
} from "@/components/loading-skeleton";

function ConnectRiotAccountCard() {
  return (
    <Card className="w-full" style={{ minHeight: "300px" }}>
      <CardContent className="flex flex-col items-center justify-center h-full py-16">
        <div className="text-center space-y-4">
          <Link2 className="h-16 w-16 mx-auto text-muted-foreground" />
          <h3 className="text-xl font-semibold">Connect Your Riot Account</h3>
          <p className="text-muted-foreground max-w-md">
            To view content on this page, connect a Riot account first. This
            will allow you to see your match history, statistics, and personal
            analyses.
          </p>
          <ConnectRiotAccountDialog />
        </div>
      </CardContent>
    </Card>
  );
}

function ProfileContent({ puuid }: { puuid: string }) {
  const queryClient = useQueryClient();

  // Fetch player data
  const {
    data: playerResult,
    isLoading: isPlayerLoading,
    error: playerError,
  } = useQuery({
    queryKey: ["player", puuid],
    queryFn: () => validatedGet(PlayerSchema, `/players/${puuid}`),
  });

  // Fetch champion stats
  const { data: championStatsResult, isLoading: isChampionLoading } = useQuery({
    queryKey: ["champion-stats", puuid],
    queryFn: () =>
      validatedGet(
        ChampionStatsResponseSchema,
        `/matches/player/${puuid}/champion-stats`,
        { queue: 420, limit: 20 },
      ),
  });

  // Fetch lane stats
  const { data: laneStatsResult, isLoading: isLaneLoading } = useQuery({
    queryKey: ["lane-stats", puuid],
    queryFn: () =>
      validatedGet(
        LaneStatsResponseSchema,
        `/matches/player/${puuid}/lane-stats`,
        {
          queue: 420,
        },
      ),
  });

  const player = playerResult?.success ? playerResult.data : null;
  const championStats = championStatsResult?.success
    ? championStatsResult.data
    : null;
  const laneStats = laneStatsResult?.success ? laneStatsResult.data : null;

  // Callback to refresh all profile data - passed to PlayerCard
  const handleRefreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ["player", puuid] });
    queryClient.invalidateQueries({ queryKey: ["champion-stats", puuid] });
    queryClient.invalidateQueries({ queryKey: ["lane-stats", puuid] });
    queryClient.invalidateQueries({ queryKey: ["recent-stats", puuid] });
    queryClient.invalidateQueries({ queryKey: ["overall-stats", puuid] });
    queryClient.invalidateQueries({
      queryKey: ["matchHistoryDetailed", puuid],
    });
    queryClient.invalidateQueries({ queryKey: ["player-league", puuid] });
    queryClient.invalidateQueries({ queryKey: ["player-stats", puuid] });
  };

  if (playerError) {
    return (
      <Card className="p-6">
        <p className="text-destructive">
          Failed to load player data. Please try again later.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Player Card + Recent Performance Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {isPlayerLoading ? (
          <PlayerCardSkeleton />
        ) : player ? (
          <PlayerCard player={player} onRefreshAll={handleRefreshAll} />
        ) : null}

        {/* Recent Performance Card */}
        {player && (
          <RecentPerformanceCard
            puuid={puuid}
            lastUpdated={player.updated_at}
          />
        )}
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Champion Stats Card */}
        {isChampionLoading ? (
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-40" />
            </CardHeader>
            <CardContent className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </CardContent>
          </Card>
        ) : championStats ? (
          <ChampionStatsCard
            stats={championStats}
            lastUpdated={player?.updated_at}
          />
        ) : null}

        {/* Role Stats Card */}
        {isLaneLoading ? (
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-32" />
            </CardHeader>
            <CardContent className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </CardContent>
          </Card>
        ) : laneStats ? (
          <RoleStatsCard stats={laneStats} lastUpdated={player?.updated_at} />
        ) : null}
      </div>

      {/* Match History */}
      {isPlayerLoading ? (
        <MatchHistorySkeleton />
      ) : player ? (
        <MatchHistory
          puuid={puuid}
          queueFilter={420}
          lastUpdated={player.updated_at}
        />
      ) : null}
    </div>
  );
}

export default function MyProfilePage() {
  const { user, isLoading } = useAuth();

  const hasRiotAccount = user?.riot_account_connected && user?.puuid;

  return (
    <ProtectedRoute>
      <div className="container mx-auto px-4 py-8">
        <div className="space-y-6">
          {/* Header Card - Full Width */}
          <Card className="bg-[#152b56] p-6 text-white dark:bg-[#0a1428]">
            <div className="mb-4 flex items-start justify-between">
              <h1 className="text-2xl font-semibold">My Profile</h1>
            </div>
            <p className="text-sm leading-relaxed">
              Your personal League of Legends dashboard. View your match
              history, champion statistics, lane performance, and detailed
              analyses all in one place.
            </p>
          </Card>

          {/* Content - either connect card or profile content */}
          {isLoading ? (
            <div className="space-y-6">
              <PlayerCardSkeleton />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Skeleton className="h-64" />
                <Skeleton className="h-64" />
              </div>
              <MatchHistorySkeleton />
            </div>
          ) : hasRiotAccount ? (
            <ProfileContent puuid={user.puuid!} />
          ) : (
            <ConnectRiotAccountCard />
          )}
        </div>
      </div>
    </ProtectedRoute>
  );
}
