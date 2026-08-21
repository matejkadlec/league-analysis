"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Scale } from "lucide-react";
import { Player } from "@/lib/core/schemas";
import {
  PlayerSelector,
  formatRiotId,
  playerQueryKey,
  playerQueryOptions,
  usePlayerContext,
} from "@/features/players";
import {
  MatchmakingAnalysis,
  MatchmakingAnalysisResults,
  MatchmakingAnalysisHistory,
  MatchmakingExplanationCard,
} from "@/features/matchmaking";
import { ProtectedRoute } from "@/features/auth";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

function MatchmakingAnalysisContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const {
    currentPlayer: referencePlayer,
    isLoading: isLoadingReferencePlayer,
  } = usePlayerContext();
  const puuidFromUrl = searchParams.get("puuid");
  const analyzedPuuid = puuidFromUrl ?? referencePlayer?.puuid ?? null;
  const { data: analyzedPlayer, isLoading: isLoadingAnalyzedPlayer } = useQuery(
    playerQueryOptions(analyzedPuuid),
  );

  useEffect(() => {
    if (puuidFromUrl || !referencePlayer) return;
    const nextUrl = `/matchmaking-analysis?puuid=${encodeURIComponent(referencePlayer.puuid)}`;
    window.history.replaceState(window.history.state, "", nextUrl);
  }, [puuidFromUrl, referencePlayer, router]);

  const handlePlayerFound = (player: Player) => {
    queryClient.setQueryData(playerQueryKey(player.puuid), player);
    router.push(
      `/matchmaking-analysis?puuid=${encodeURIComponent(player.puuid)}`,
      { scroll: false },
    );
  };

  const selector = (
    <PlayerSelector
      id="matchmaking-player-search"
      ariaLabel="Choose player for analysis"
      placeholder="Search for player"
      onPlayerSelected={handlePlayerFound}
    />
  );
  const isLoadingInitialPlayer =
    isLoadingReferencePlayer || isLoadingAnalyzedPlayer;
  const analyzedPlayerLabel = analyzedPlayer ? formatRiotId(analyzedPlayer) : "";

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
              teammates vs enemies in recent ranked matches.
            </p>
          </Card>
        </div>
      </div>

      {/* Content - shows skeletons during initial load */}
      <div className="container mx-auto px-4 pb-8">
        <div className="mb-6 space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {isLoadingInitialPlayer ? (
              [...Array(4)].map((_, index) => (
                <Card key={index} className="p-6 space-y-4">
                  <Skeleton className="h-6 w-48" />
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-10 w-full" />
                </Card>
              ))
            ) : analyzedPlayer ? (
              <>
                <MatchmakingAnalysis
                  key={analyzedPlayer.puuid}
                  puuid={analyzedPlayer.puuid}
                  analyzedPlayerLabel={analyzedPlayerLabel}
                  playerSelector={selector}
                />
                <MatchmakingAnalysisResults
                  puuid={analyzedPlayer.puuid}
                  analyzedPlayerLabel={analyzedPlayerLabel}
                />
                <MatchmakingExplanationCard />
                <MatchmakingAnalysisHistory
                  puuid={analyzedPlayer.puuid}
                  analyzedPlayerLabel={analyzedPlayerLabel}
                />
              </>
            ) : (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Scale className="h-5 w-5 text-primary" />
                      Matchmaking Analysis
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Choose a local analyzed player. This selection will not
                      change or track the global reference player.
                    </p>
                    <div className="space-y-1.5">
                      <Label htmlFor="matchmaking-player-search">
                        Choose player for analysis
                      </Label>
                      {selector}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Last Analysis Result</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    Select a player to load their latest completed result.
                  </CardContent>
                </Card>
                <MatchmakingExplanationCard />
                <Card>
                  <CardHeader>
                    <CardTitle>Analysis History</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    Select a player to load their analysis history.
                  </CardContent>
                </Card>
              </>
            )}
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
                <Skeleton className="h-48 w-full rounded-lg" />
                <Skeleton className="h-48 w-full rounded-lg" />
              </div>
              <div className="space-y-6">
                <Skeleton className="h-48 w-full rounded-lg" />
                <Skeleton className="h-48 w-full rounded-lg" />
              </div>
            </div>
          </div>
        }
      >
        <MatchmakingAnalysisContent />
      </Suspense>
    </ProtectedRoute>
  );
}
