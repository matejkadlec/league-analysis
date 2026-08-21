"use client";

import { useQuery } from "@tanstack/react-query";

import { PageHeader } from "@/components/page-header";
import { PlayerCardSkeleton } from "@/components/loading-skeleton";
import {
  SectionQuickNavigation,
  type SectionQuickNavigationItem,
} from "@/components/section-quick-navigation";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ProtectedRoute } from "@/features/auth";
import { RANKED_SOLO_QUEUE_ID } from "@/features/matches";
import {
  PlayerCard,
  SelectPlayerCard,
  playerQueryOptions,
  usePlayerContext,
} from "@/features/players";
import {
  ChampionStatsCard,
  RecentPerformanceCard,
  RoleStatsCard,
} from "@/features/profile";
import { unwrap, validatedGet } from "@/lib/core/api";
import {
  ChampionStatsResponseSchema,
  LaneStatsResponseSchema,
} from "@/lib/core/schemas";

const PLAYER_OVERVIEW_NAV_ITEMS: SectionQuickNavigationItem[] = [
  { label: "Player Summary", anchor: "#player-summary" },
  { label: "Recent Performance", anchor: "#recent-performance" },
  { label: "Top Champions", anchor: "#top-champions" },
  { label: "Role Performance", anchor: "#role-performance" },
];

function PlayerOverviewSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <PlayerCardSkeleton />
        <Skeleton className="h-72" />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    </div>
  );
}

function PlayerOverviewContent({ puuid }: { puuid: string }) {
  const {
    data: player,
    isLoading: isPlayerLoading,
    error: playerError,
  } = useQuery(playerQueryOptions(puuid));
  const { data: championStats = null, isLoading: isChampionLoading } = useQuery(
    {
      queryKey: ["champion-stats", puuid, RANKED_SOLO_QUEUE_ID],
      queryFn: async () =>
        unwrap(
          await validatedGet(
            ChampionStatsResponseSchema,
            `/matches/player/${puuid}/champion-stats`,
            { queues: String(RANKED_SOLO_QUEUE_ID) },
          ),
        ),
    },
  );
  const { data: laneStats = null, isLoading: isLaneLoading } = useQuery({
    queryKey: ["lane-stats", puuid, RANKED_SOLO_QUEUE_ID],
    queryFn: async () =>
      unwrap(
        await validatedGet(
          LaneStatsResponseSchema,
          `/matches/player/${puuid}/lane-stats`,
          { queues: String(RANKED_SOLO_QUEUE_ID) },
        ),
      ),
  });

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
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {isPlayerLoading ? (
          <PlayerCardSkeleton />
        ) : player ? (
          <PlayerCard player={player} />
        ) : null}
        {player && (
          <RecentPerformanceCard
            puuid={puuid}
            lastUpdated={player.match_synced_at}
          />
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {isChampionLoading ? (
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-40" />
            </CardHeader>
            <CardContent className="space-y-2">
              {[...Array(5)].map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </CardContent>
          </Card>
        ) : championStats ? (
          <ChampionStatsCard
            stats={championStats}
            lastUpdated={player?.match_synced_at}
            dataSourceKey={`${puuid}:queue:${RANKED_SOLO_QUEUE_ID}`}
          />
        ) : null}

        {isLaneLoading ? (
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-32" />
            </CardHeader>
            <CardContent className="space-y-2">
              {[...Array(5)].map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
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
    </div>
  );
}

export default function PlayerOverviewPage() {
  const { currentPlayer, isLoading } = usePlayerContext();

  return (
    <ProtectedRoute>
      {currentPlayer && (
        <SectionQuickNavigation items={PLAYER_OVERVIEW_NAV_ITEMS} />
      )}
      <div className="container mx-auto px-4 py-8">
        <div className="space-y-6">
          <PageHeader title="Player Overview">
            <p className="text-sm leading-relaxed">
              Review player&apos;s rank, recent performance, champion statistics,
              and role performance in one dashboard.
            </p>
          </PageHeader>

          {isLoading ? (
            <PlayerOverviewSkeleton />
          ) : currentPlayer ? (
            <PlayerOverviewContent puuid={currentPlayer.puuid} />
          ) : (
            <SelectPlayerCard />
          )}
        </div>
      </div>
    </ProtectedRoute>
  );
}
