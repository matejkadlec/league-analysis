"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ProtectedRoute } from "@/features/auth";
import {
  ChampionStatsResponseSchema,
  LaneStatsResponseSchema,
} from "@/lib/core/schemas";
import { validatedGet } from "@/lib/core/api";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { UserRoundSearch } from "lucide-react";
import {
  PlayerCard,
  playerQueryKey,
  playerQueryOptions,
  usePlayerContext,
} from "@/features/players";
import { MatchHistory } from "@/features/matches";
import {
  ChampionStatsCard,
  RoleStatsCard,
  RecentPerformanceCard,
} from "@/features/profile";
import {
  PlayerCardSkeleton,
  MatchHistorySkeleton,
} from "@/components/loading-skeleton";
import {
  SectionQuickNavigation,
  type SectionQuickNavigationItem,
} from "@/components/section-quick-navigation";

const PROFILE_NAV_ITEMS: SectionQuickNavigationItem[] = [
  { label: "Player Summary", anchor: "#player-summary" },
  { label: "Recent Performance", anchor: "#recent-performance" },
  { label: "Top Champions", anchor: "#top-champions" },
  { label: "Role Performance", anchor: "#role-performance" },
  { label: "Match History", anchor: "#match-history" },
];

function SelectPlayerCard() {
  return (
    <Card className="w-full" style={{ minHeight: "300px" }}>
      <CardContent className="flex flex-col items-center justify-center h-full py-16">
        <div className="text-center space-y-4">
          <UserRoundSearch className="h-16 w-16 mx-auto text-muted-foreground" />
          <h3 className="text-xl font-semibold">Select a player</h3>
          <p className="text-muted-foreground max-w-md">
            Search from the sidebar or choose one of your recent tracked players
            to open their dashboard.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function ProfileContent({ puuid }: { puuid: string }) {
  const queryClient = useQueryClient();

  // Fetch player data
  const {
    data: player,
    isLoading: isPlayerLoading,
    error: playerError,
  } = useQuery(playerQueryOptions(puuid));

  // Fetch champion stats
  const { data: championStatsResult, isLoading: isChampionLoading } = useQuery({
    queryKey: ["champion-stats", puuid],
    queryFn: () =>
      validatedGet(
        ChampionStatsResponseSchema,
        `/matches/player/${puuid}/champion-stats`,
        { queue: 420 },
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

  const championStats = championStatsResult?.success
    ? championStatsResult.data
    : null;
  const laneStats = laneStatsResult?.success ? laneStatsResult.data : null;

  // Callback to refresh all profile data - passed to PlayerCard
  const handleRefreshAll = () => {
    queryClient.invalidateQueries({ queryKey: playerQueryKey(puuid) });
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
            lastUpdated={player.match_synced_at}
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
            lastUpdated={player?.match_synced_at}
            dataSourceKey={`${puuid}:queue:420`}
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
          <RoleStatsCard
            stats={laneStats}
            lastUpdated={player?.match_synced_at}
          />
        ) : null}
      </div>

      {/* Match History */}
      {isPlayerLoading ? (
        <MatchHistorySkeleton />
      ) : player ? (
        <MatchHistory puuid={puuid} lastUpdated={player.match_synced_at} />
      ) : null}
    </div>
  );
}

export default function MyProfilePage() {
  const { currentPlayer, isLoading } = usePlayerContext();

  return (
    <ProtectedRoute>
      {currentPlayer && <SectionQuickNavigation items={PROFILE_NAV_ITEMS} />}
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

          {/* Content follows the URL-scoped global player context. */}
          {isLoading ? (
            <div className="space-y-6">
              <PlayerCardSkeleton />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Skeleton className="h-64" />
                <Skeleton className="h-64" />
              </div>
              <MatchHistorySkeleton />
            </div>
          ) : currentPlayer ? (
            <ProfileContent puuid={currentPlayer.puuid} />
          ) : (
            <SelectPlayerCard />
          )}
        </div>
      </div>
    </ProtectedRoute>
  );
}
