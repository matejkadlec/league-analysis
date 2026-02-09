"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Loader2 } from "lucide-react";

import { ProtectedRoute, useAuth } from "@/features/auth";
import {
  AddTrackedPlayer,
  PlayerCard,
  TrackedPlayersList,
} from "@/features/players";
import {
  ChampionStatsCard,
  RecentPerformanceCard,
  RoleStatsCard,
} from "@/features/profile";
import { MatchHistory } from "@/features/matches";
import {
  ChampionStatsResponseSchema,
  LaneStatsResponseSchema,
  PlayerSchema,
  UserSettingsSchema,
  type Player,
} from "@/lib/core/schemas";
import { validatedGet, validatedPut } from "@/lib/core/api";
import { cn } from "@/lib/core/utils";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MatchHistorySkeleton,
  PlayerCardSkeleton,
} from "@/components/loading-skeleton";

interface NavigationItem {
  label: string;
  anchor: string;
}

const TRACKED_PLAYER_NAV_ITEMS: NavigationItem[] = [
  { label: "Add Tracker Player", anchor: "#add-tracked-player" },
  { label: "Tracked Players", anchor: "#tracked-players" },
  { label: "Player Summary", anchor: "#player-summary" },
  { label: "Recent Performance", anchor: "#recent-performance" },
  { label: "Top Champions", anchor: "#top-champions" },
  { label: "Role Performance", anchor: "#role-performance" },
  { label: "MatchHistory", anchor: "#match-history" },
];

interface TrackedPlayersQuickNavigationProps {
  items: NavigationItem[];
}

function TrackedPlayersQuickNavigation({
  items,
}: TrackedPlayersQuickNavigationProps) {
  const [isHovered, setIsHovered] = useState(false);

  const scrollToAnchor = (anchor: string) => {
    const element = document.querySelector(anchor);
    if (!element) {
      return;
    }

    element.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div
      className="fixed right-0 top-1/2 z-40 -translate-y-1/2"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="flex h-[242px] items-stretch">
        <div className="vertical-gradient flex w-10 items-center justify-center rounded-l-lg border-l border-y border-r-0 border-[#2f3640]">
          <ChevronLeft
            className={cn(
              "h-4 w-4 text-[#2f3640] transition-transform duration-300",
              isHovered ? "rotate-180" : "rotate-0",
            )}
          />
        </div>

        <div
          className={cn(
            "overflow-hidden border-y border-[#2f3640] border-l-0 border-r-0 bg-card/95 shadow-lg backdrop-blur-sm transition-[width,opacity,transform] duration-300 ease-out",
            isHovered
              ? "w-[180px] translate-x-0 opacity-100"
              : "w-0 translate-x-full opacity-0",
          )}
        >
          <nav className="h-auto w-[180px] py-2">
            <ul className="flex h-full flex-col justify-center">
              {items.map((item) => (
                <li key={item.anchor}>
                  <button
                    type="button"
                    className="w-full cursor-pointer px-4 py-1.5 text-left text-sm transition-all duration-300 hover:bg-accent/35 hover:text-[#cfa93a]"
                    onClick={() => scrollToAnchor(item.anchor)}
                  >
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </div>
    </div>
  );
}

function TrackedPlayerProfileContent({ puuid }: { puuid: string }) {
  const queryClient = useQueryClient();

  const {
    data: playerResult,
    isLoading: isPlayerLoading,
    isFetching: isPlayerFetching,
    error: playerError,
  } = useQuery({
    queryKey: ["player", puuid],
    queryFn: () => validatedGet(PlayerSchema, `/players/${puuid}`),
    placeholderData: (previousData) => previousData,
  });

  const {
    data: championStatsResult,
    isLoading: isChampionLoading,
    isFetching: isChampionFetching,
  } = useQuery({
    queryKey: ["champion-stats", puuid],
    queryFn: () =>
      validatedGet(
        ChampionStatsResponseSchema,
        `/matches/player/${puuid}/champion-stats`,
        {
          queue: 420,
          limit: 20,
        },
      ),
    placeholderData: (previousData) => previousData,
  });

  const {
    data: laneStatsResult,
    isLoading: isLaneLoading,
    isFetching: isLaneFetching,
  } = useQuery({
    queryKey: ["lane-stats", puuid],
    queryFn: () =>
      validatedGet(LaneStatsResponseSchema, `/matches/player/${puuid}/lane-stats`, {
        queue: 420,
      }),
    placeholderData: (previousData) => previousData,
  });

  const player = playerResult?.success ? playerResult.data : null;
  const championStats = championStatsResult?.success
    ? championStatsResult.data
    : null;
  const laneStats = laneStatsResult?.success ? laneStatsResult.data : null;

  const isFirstLoad = !playerResult && isPlayerLoading;
  const isSwitchingPlayer =
    !!playerResult && (isPlayerFetching || isChampionFetching || isLaneFetching);

  const handleRefreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ["player", puuid] });
    queryClient.invalidateQueries({ queryKey: ["champion-stats", puuid] });
    queryClient.invalidateQueries({ queryKey: ["lane-stats", puuid] });
    queryClient.invalidateQueries({ queryKey: ["recent-stats", puuid] });
    queryClient.invalidateQueries({ queryKey: ["overall-stats", puuid] });
    queryClient.invalidateQueries({ queryKey: ["matchHistoryDetailed", puuid] });
    queryClient.invalidateQueries({ queryKey: ["player-league", puuid] });
    queryClient.invalidateQueries({ queryKey: ["player-stats", puuid] });
  };

  if (playerError && !playerResult) {
    return (
      <Card className="p-6">
        <p className="text-destructive">
          Failed to load player data. Please try again later.
        </p>
      </Card>
    );
  }

  if (isFirstLoad) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <PlayerCardSkeleton />
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
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-40" />
            </CardHeader>
            <CardContent className="space-y-2">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-32" />
            </CardHeader>
            <CardContent className="space-y-2">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </CardContent>
          </Card>
        </div>
        <MatchHistorySkeleton />
      </div>
    );
  }

  return (
    <div className="relative space-y-6">
      {isSwitchingPlayer && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-lg bg-background/55 backdrop-blur-[1px]">
          <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 shadow-sm">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="text-sm">Loading selected player...</span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {player ? (
          <PlayerCard player={player} onRefreshAll={handleRefreshAll} />
        ) : (
          <Card className="p-6">
            <p className="text-muted-foreground">Player summary unavailable.</p>
          </Card>
        )}

        {player ? (
          <RecentPerformanceCard puuid={puuid} lastUpdated={player.updated_at} />
        ) : (
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
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {isChampionLoading && !championStats ? (
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-40" />
            </CardHeader>
            <CardContent className="space-y-2">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </CardContent>
          </Card>
        ) : championStats ? (
          <ChampionStatsCard stats={championStats} lastUpdated={player?.updated_at} />
        ) : (
          <Card className="p-6">
            <p className="text-muted-foreground">Champion stats unavailable.</p>
          </Card>
        )}

        {isLaneLoading && !laneStats ? (
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-32" />
            </CardHeader>
            <CardContent className="space-y-2">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </CardContent>
          </Card>
        ) : laneStats ? (
          <RoleStatsCard stats={laneStats} lastUpdated={player?.updated_at} />
        ) : (
          <Card className="p-6">
            <p className="text-muted-foreground">Role stats unavailable.</p>
          </Card>
        )}
      </div>

      {player ? (
        <MatchHistory puuid={puuid} lastUpdated={player.updated_at} />
      ) : (
        <MatchHistorySkeleton />
      )}
    </div>
  );
}

export default function TrackedPlayersPage() {
  const { user } = useAuth();
  const userId = user?.id;
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const initialLoadDone = useRef(false);
  const loadedPuuidRef = useRef<string | null>(null);

  const { data: userSettingsResult } = useQuery({
    queryKey: ["user-settings", userId],
    queryFn: () => validatedGet(UserSettingsSchema, "/settings/user"),
    enabled: !!userId,
    staleTime: 60000,
  });

  const userSettings = userSettingsResult?.success
    ? userSettingsResult.data
    : null;

  const saveTrackedPuuidMutation = useMutation({
    mutationFn: async (puuid: string | null) => {
      const result = await validatedPut(UserSettingsSchema, "/settings/user", {
        saved_tracked_puuid: puuid,
      });

      if (!result.success) {
        throw new Error(result.error.message);
      }

      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-settings", userId] });
    },
  });

  useEffect(() => {
    if (initialLoadDone.current) {
      return;
    }

    const puuidFromUrl = searchParams.get("puuid");

    if (puuidFromUrl && loadedPuuidRef.current !== puuidFromUrl) {
      initialLoadDone.current = true;
      loadedPuuidRef.current = puuidFromUrl;

      validatedGet(PlayerSchema, `/players/${puuidFromUrl}`)
        .then((result) => {
          if (result.success) {
            setSelectedPlayer(result.data);
            return;
          }

          loadedPuuidRef.current = null;
          router.push("/tracked-players", { scroll: false });
        })
        .catch(() => {
          loadedPuuidRef.current = null;
          router.push("/tracked-players", { scroll: false });
        });

      return;
    }

    if (
      !puuidFromUrl &&
      userSettings?.save_tracked_url &&
      userSettings?.saved_tracked_puuid
    ) {
      initialLoadDone.current = true;
      loadedPuuidRef.current = userSettings.saved_tracked_puuid;

      validatedGet(PlayerSchema, `/players/${userSettings.saved_tracked_puuid}`)
        .then((result) => {
          if (!result.success) {
            loadedPuuidRef.current = null;
            return;
          }

          setSelectedPlayer(result.data);
          router.push(
            `/tracked-players?puuid=${userSettings.saved_tracked_puuid}`,
            {
              scroll: false,
            },
          );
        })
        .catch(() => {
          loadedPuuidRef.current = null;
        });
    }
  }, [router, searchParams, userSettings]);

  const handleViewedPlayerChange = (player: Player | null) => {
    setSelectedPlayer(player);

    if (player) {
      loadedPuuidRef.current = player.puuid;
      initialLoadDone.current = true;
      router.push(`/tracked-players?puuid=${player.puuid}`, { scroll: false });

      if (userSettings?.save_tracked_url) {
        saveTrackedPuuidMutation.mutate(player.puuid);
      }

      return;
    }

    loadedPuuidRef.current = null;
    initialLoadDone.current = true;
    router.push("/tracked-players", { scroll: false });

    if (userSettings?.save_tracked_url) {
      saveTrackedPuuidMutation.mutate(null);
    }
  };

  return (
    <ProtectedRoute>
      {selectedPlayer && (
        <TrackedPlayersQuickNavigation items={TRACKED_PLAYER_NAV_ITEMS} />
      )}

      <div className="container mx-auto px-4 py-8">
        <div className="mb-6 space-y-6">
          <Card
            id="header-card"
            className="bg-[#152b56] p-6 text-white dark:bg-[#0a1428]"
          >
            <div className="mb-4 flex items-start justify-between">
              <h1 className="text-2xl font-semibold">Tracked Players</h1>
            </div>
            <p className="text-sm leading-relaxed">
              Track League of Legends players for automated match history
              updates and continuous monitoring. Tracked players are
              automatically updated every 2 minutes by background jobs.
            </p>
          </Card>

          <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-2">
            <AddTrackedPlayer />
            <TrackedPlayersList
              className="h-full"
              selectedPlayerPuuid={selectedPlayer?.puuid ?? null}
              onViewPlayerChange={handleViewedPlayerChange}
            />
          </div>

          {selectedPlayer && (
            <TrackedPlayerProfileContent puuid={selectedPlayer.puuid} />
          )}
        </div>
      </div>
    </ProtectedRoute>
  );
}
