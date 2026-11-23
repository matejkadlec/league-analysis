"use client";

import { Suspense, useState, type ReactNode } from "react";
import { History, Medal, Scale, TrendingUp } from "lucide-react";
import {
  PlayerSelector,
  formatRiotId,
  useAnalyzedPlayer,
} from "@/features/players";
import {
  MatchmakingAnalysis,
  MatchmakingAnalysisLoadingCard,
  MatchmakingAnalysisResults,
  MatchmakingAnalysisResultsSkeleton,
  MatchmakingAnalysisHistory,
  MatchmakingExplanationCard,
} from "@/features/matchmaking";
import { ProtectedRoute } from "@/features/auth";

import { PageHeader } from "@/components/page-header";
import { PageSections, Section, SectionRow } from "@/components/page-sections";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

// The run card leads at half width, a short form that read empty stretched
// across the page. Then the two result cards as one row, the history they are
// picked from (closed until wanted), and the flowchart as reference.
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
    <PageSections>
      <Section width="half">{start}</Section>
      {results}
      <Section>{history}</Section>
      <Section>{explanation}</Section>
    </PageSections>
  );
}

function PlaceholderCard({
  icon: Icon,
  title,
  message,
}: {
  icon: typeof Scale;
  title: string;
  message: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        {message}
      </CardContent>
    </Card>
  );
}

function HistorySkeleton() {
  return (
    <Card className="p-6 space-y-3">
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-4 w-64" />
    </Card>
  );
}

function ExplanationSkeleton() {
  return (
    <Card className="p-6 space-y-4">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-20 w-full" />
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
              start={<MatchmakingAnalysisLoadingCard />}
              results={<MatchmakingAnalysisResultsSkeleton />}
              history={<HistorySkeleton />}
              explanation={<ExplanationSkeleton />}
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
                <SectionRow>
                  <PlaceholderCard
                    icon={TrendingUp}
                    title="Win Rates & Verdict"
                    message="Select a player to load their latest completed result."
                  />
                  <PlaceholderCard
                    icon={Medal}
                    title="Ranks"
                    message="Select a player to load their latest completed result."
                  />
                </SectionRow>
              }
              history={
                <PlaceholderCard
                  icon={History}
                  title="Analysis History"
                  message="Select a player to load their analysis history."
                />
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
            <AnalysisLayout
              start={<MatchmakingAnalysisLoadingCard />}
              results={<MatchmakingAnalysisResultsSkeleton />}
              history={<HistorySkeleton />}
              explanation={<ExplanationSkeleton />}
            />
          </div>
        }
      >
        <MatchmakingAnalysisContent />
      </Suspense>
    </ProtectedRoute>
  );
}
