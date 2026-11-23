"use client";

import { useQuery } from "@tanstack/react-query";

import { PageHeader } from "@/components/page-header";
import {
  PageSections,
  Section,
  SectionRow,
} from "@/components/page-sections";
import {
  SectionQuickNavigation,
  type SectionQuickNavigationItem,
} from "@/components/section-quick-navigation";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ProtectedRoute } from "@/features/auth";
import { RANKED_SOLO_QUEUE_ID } from "@/lib/core/riot/queue-catalog";
import { cn } from "@/lib/core/utils";
import {
  PlayerCard,
  PlayerCardSkeleton,
  SelectPlayerCard,
  playerQueryOptions,
  usePlayerContext,
} from "@/features/players";
import {
  ChampionStatsCard,
  RecentPerformanceCard,
  RoleStatsCard,
  championStatsQueryOptions,
  laneStatsQueryOptions,
} from "@/features/profile";

const PLAYER_OVERVIEW_NAV_ITEMS: SectionQuickNavigationItem[] = [
  { label: "Player Summary", anchor: "#player-summary" },
  { label: "Recent Performance", anchor: "#recent-performance" },
  { label: "Top Champions", anchor: "#top-champions" },
  { label: "Role Performance", anchor: "#role-performance" },
];

// Placeholders in the loaded layout's geometry, so nothing moves when the
// queries answer: the summary row, then the two full-width lists.
function ListCardSkeleton({ rows, columns }: { rows: number; columns: 1 | 2 }) {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-40" />
      </CardHeader>
      <CardContent
        className={cn(
          columns === 2
            ? "grid grid-cols-1 gap-3 xl:grid-flow-col xl:grid-cols-2 xl:grid-rows-5 xl:gap-x-8"
            : "space-y-4",
        )}
      >
        {[...Array(rows)].map((_, index) => (
          <Skeleton key={index} className="h-14 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}

function SummaryCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-48" />
      </CardHeader>
      <CardContent className="space-y-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </CardContent>
    </Card>
  );
}

function PlayerOverviewSkeleton() {
  return (
    <PageSections>
      <SectionRow>
        <PlayerCardSkeleton />
        <SummaryCardSkeleton />
      </SectionRow>
      <Section>
        <ListCardSkeleton rows={10} columns={2} />
      </Section>
      <Section>
        <ListCardSkeleton rows={5} columns={1} />
      </Section>
    </PageSections>
  );
}

function PlayerOverviewContent({ puuid }: { puuid: string }) {
  const {
    data: player,
    isLoading: isPlayerLoading,
    error: playerError,
  } = useQuery(playerQueryOptions(puuid));
  const { data: championStats = null, isLoading: isChampionLoading } = useQuery(
    championStatsQueryOptions(puuid),
  );
  const { data: laneStats = null, isLoading: isLaneLoading } = useQuery(
    laneStatsQueryOptions(puuid),
  );

  if (playerError) {
    return (
      <Card className="p-6">
        <p className="text-destructive">
          Failed to load player data. Please try again later.
        </p>
      </Card>
    );
  }

  // Summary and recent form are read together and balance each other, so
  // they share a row. Each list gets the whole width, which is what lets Top
  // Champions show ten instead of matching Role Performance's five rows.
  return (
    <PageSections>
      <SectionRow>
        {isPlayerLoading ? (
          <PlayerCardSkeleton />
        ) : player ? (
          <PlayerCard player={player} />
        ) : null}
        {isPlayerLoading ? (
          <SummaryCardSkeleton />
        ) : player ? (
          <RecentPerformanceCard
            puuid={puuid}
            lastUpdated={player.match_synced_at}
          />
        ) : null}
      </SectionRow>

      <Section>
        {isChampionLoading ? (
          <ListCardSkeleton rows={10} columns={2} />
        ) : championStats ? (
          <ChampionStatsCard
            stats={championStats}
            lastUpdated={player?.match_synced_at}
            dataSourceKey={`${puuid}:queue:${RANKED_SOLO_QUEUE_ID}`}
          />
        ) : null}
      </Section>

      <Section>
        {isLaneLoading ? (
          <ListCardSkeleton rows={5} columns={1} />
        ) : laneStats ? (
          <RoleStatsCard
            stats={laneStats}
            lastUpdated={player?.match_synced_at}
          />
        ) : null}
      </Section>
    </PageSections>
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
        <PageSections>
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
            <Section>
              <SelectPlayerCard />
            </Section>
          )}
        </PageSections>
      </div>
    </ProtectedRoute>
  );
}
