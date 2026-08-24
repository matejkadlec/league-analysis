"use client";

import { Suspense } from "react";
import { Scale } from "lucide-react";
import {
  PlayerSelector,
  formatRiotId,
  useAnalyzedPlayer,
} from "@/features/players";
import {
  MatchmakingAnalysis,
  MatchmakingAnalysisResults,
  MatchmakingAnalysisHistory,
  MatchmakingExplanationCard,
} from "@/features/matchmaking";
import { ProtectedRoute } from "@/features/auth";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

function MatchmakingAnalysisContent() {
  const {
    analyzedPlayer,
    isLoading: isLoadingScope,
    selectAnalyzedPlayer,
  } = useAnalyzedPlayer();

  const analyzedPlayerLabel = analyzedPlayer ? formatRiotId(analyzedPlayer) : "";
  const selector = (
    <PlayerSelector
      id="matchmaking-player-search"
      ariaLabel="Choose player for analysis"
      placeholder="Search for player"
      onPlayerSelected={selectAnalyzedPlayer}
      initialSearchValue={analyzedPlayerLabel}
    />
  );

  return (
    <>
      {/* Header card - always shows immediately */}
      <div className="container mx-auto px-4 pt-8">
        <div className="mb-6">
          <PageHeader title="Matchmaking Analysis">
            <p className="text-sm leading-relaxed">
              Analyze matchmaking fairness by comparing average winrates of
              teammates vs enemies in recent ranked matches.
            </p>
          </PageHeader>
        </div>
      </div>

      {/* Content - shows skeletons during initial load */}
      <div className="container mx-auto px-4 pb-8">
        <div className="mb-6 space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {isLoadingScope ? (
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
