"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Player } from "@/lib/core/schemas";
import {
  PlayerSearch,
  PlayerCard,
  playerQueryKey,
  playerQueryOptions,
} from "@/features/players";
import {
  MatchmakingAnalysis,
  MatchmakingAnalysisResults,
  MatchmakingAnalysisHistory,
  MatchmakingExplanationCard,
} from "@/features/matchmaking";
import { ProtectedRoute } from "@/features/auth";

import { Card } from "@/components/ui/card";
import { PlayerCardSkeleton } from "@/components/loading-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

function MatchmakingAnalysisContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const puuidFromUrl = searchParams.get("puuid");
  const { data: selectedPlayer, isLoading: isLoadingInitialPlayer } = useQuery(
    playerQueryOptions(puuidFromUrl),
  );

  const handlePlayerFound = (player: Player) => {
    queryClient.setQueryData(playerQueryKey(player.puuid), player);
    router.push(`/matchmaking-analysis?puuid=${player.puuid}`, {
      scroll: false,
    });
  };

  const handleClearPlayer = () => {
    router.push("/matchmaking-analysis", { scroll: false });

    // Invalidate any queries related to this player
    queryClient.invalidateQueries({ queryKey: ["matchmaking-analysis"] });
    queryClient.invalidateQueries({
      queryKey: ["matchmaking-analysis-results"],
    });
  };

  return (
    <>
      {/* Header card - always shows immediately */}
      <div className="container mx-auto px-4 pt-8">
        <div className="mb-6">
          <Card
            id="header-card"
            className="bg-[#152b56] p-6 text-white dark:bg-[#0a1428]"
          >
            <div className="mb-4 flex items-start justify-between">
              <h1 className="text-2xl font-semibold">Matchmaking Analysis</h1>
            </div>
            <p className="text-sm leading-relaxed">
              Analyze matchmaking fairness by comparing average winrates of
              teammates vs enemies in recent ranked matches
            </p>
          </Card>
        </div>
      </div>

      {/* Content - shows skeletons during initial load */}
      <div className="container mx-auto px-4 pb-8">
        <div className="mb-6 space-y-6">
          {/* Two Column Layout */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Left Column: Player Search + Matchmaking Analysis */}
            <div className="space-y-6">
              <PlayerSearch
                onPlayerFound={handlePlayerFound}
                onClear={handleClearPlayer}
                showClear={!!selectedPlayer}
              />
              {isLoadingInitialPlayer ? (
                <>
                  <Card className="p-6">
                    <Skeleton className="h-6 w-48 mb-4" />
                    <Skeleton className="h-10 w-full mb-2" />
                    <Skeleton className="h-4 w-32" />
                  </Card>
                  <Card className="p-6 space-y-4">
                    <Skeleton className="h-6 w-40" />
                    {[...Array(3)].map((_, i) => (
                      <Skeleton key={i} className="h-16 w-full" />
                    ))}
                  </Card>
                </>
              ) : selectedPlayer ? (
                <>
                  <MatchmakingAnalysis puuid={selectedPlayer.puuid} />
                  <MatchmakingAnalysisResults puuid={selectedPlayer.puuid} />
                  <MatchmakingExplanationCard />
                </>
              ) : null}
            </div>

            {/* Right Column: Player Card + Analysis History */}
            <div className="space-y-6">
              {isLoadingInitialPlayer ? (
                <PlayerCardSkeleton />
              ) : selectedPlayer ? (
                <>
                  <Suspense fallback={<PlayerCardSkeleton />}>
                    <PlayerCard player={selectedPlayer} />
                  </Suspense>
                  <MatchmakingAnalysisHistory puuid={selectedPlayer.puuid} />
                </>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default function MatchmakingAnalysisPage() {
  return (
    <ProtectedRoute>
      <Suspense
        fallback={
          <div className="container mx-auto px-4 pt-8">
            <Skeleton className="h-32 w-full rounded-lg mb-6" />
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="space-y-6">
                <Skeleton className="h-20 w-full rounded-lg" />
                <Skeleton className="h-48 w-full rounded-lg" />
              </div>
              <Skeleton className="h-80 w-full rounded-lg" />
            </div>
          </div>
        }
      >
        <MatchmakingAnalysisContent />
      </Suspense>
    </ProtectedRoute>
  );
}
