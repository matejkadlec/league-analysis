"use client";

import { Suspense, useState, type ReactNode } from "react";
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

// The run card leads full width: starting an analysis is why people come here.
function AnalysisLayout({
  start,
  results,
  history,
  explanation,
}: {
  start: ReactNode;
  results: ReactNode;
  history: ReactNode;
  explanation: ReactNode;
}) {
  return (
    <div className="space-y-6">
      {start}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {results}
        {history}
      </div>
      {explanation}
    </div>
  );
}

function LoadingCard() {
  return (
    <Card className="p-6 space-y-4">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-10 w-full" />
    </Card>
  );
}

function MatchmakingAnalysisContent() {
  const {
    analyzedPlayer,
    isLoading: isLoadingScope,
    selectAnalyzedPlayer,
  } = useAnalyzedPlayer();

  // Kept with the player it was picked for, so switching players falls back to
  // that player's latest run instead of asking for a stranger's timestamp.
  const [selection, setSelection] = useState<{
    puuid: string;
    createdAt: string;
  } | null>(null);
  const selectedCreatedAt =
    selection && selection.puuid === analyzedPlayer?.puuid
      ? selection.createdAt
      : null;
  const selectAnalysis = (createdAt: string | null) => {
    setSelection(
      createdAt && analyzedPlayer
        ? { puuid: analyzedPlayer.puuid, createdAt }
        : null,
    );
  };

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
        <div className="mb-6">
          {isLoadingScope ? (
            <AnalysisLayout
              start={<LoadingCard />}
              results={<LoadingCard />}
              history={<LoadingCard />}
              explanation={<LoadingCard />}
            />
          ) : analyzedPlayer ? (
            <AnalysisLayout
              start={
                <MatchmakingAnalysis
                  key={analyzedPlayer.puuid}
                  puuid={analyzedPlayer.puuid}
                  analyzedPlayerLabel={analyzedPlayerLabel}
                  playerSelector={selector}
                />
              }
              results={
                <MatchmakingAnalysisResults
                  puuid={analyzedPlayer.puuid}
                  analyzedPlayerLabel={analyzedPlayerLabel}
                  selectedCreatedAt={selectedCreatedAt}
                  onShowLatest={() => selectAnalysis(null)}
                />
              }
              history={
                <MatchmakingAnalysisHistory
                  puuid={analyzedPlayer.puuid}
                  analyzedPlayerLabel={analyzedPlayerLabel}
                  selectedCreatedAt={selectedCreatedAt}
                  onSelect={selectAnalysis}
                />
              }
              explanation={<MatchmakingExplanationCard />}
            />
          ) : (
            <AnalysisLayout
              start={
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
              }
              results={
                <Card>
                  <CardHeader>
                    <CardTitle>Last Analysis Result</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    Select a player to load their latest completed result.
                  </CardContent>
                </Card>
              }
              history={
                <Card>
                  <CardHeader>
                    <CardTitle>Analysis History</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    Select a player to load their analysis history.
                  </CardContent>
                </Card>
              }
              explanation={<MatchmakingExplanationCard />}
            />
          )}
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
            <div className="space-y-6">
              <Skeleton className="h-48 w-full rounded-lg" />
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <Skeleton className="h-48 w-full rounded-lg" />
                <Skeleton className="h-48 w-full rounded-lg" />
              </div>
              <Skeleton className="h-48 w-full rounded-lg" />
            </div>
          </div>
        }
      >
        <MatchmakingAnalysisContent />
      </Suspense>
    </ProtectedRoute>
  );
}
