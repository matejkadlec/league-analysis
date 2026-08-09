"use client";

import { Suspense } from "react";
import { UserRoundSearch } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import {
  PlayerCardSkeleton,
  PlaystyleAnalysisSkeleton,
} from "@/components/loading-skeleton";
import { ProtectedRoute } from "@/features/auth";
import { PlayerCard, usePlayerContext } from "@/features/players";
import { PlaystyleAnalysis } from "@/features/playstyle-analysis";

export default function PlaystyleAnalysisPage() {
  const { currentPlayer, isLoading } = usePlayerContext();

  return (
    <ProtectedRoute>
      <div className="container mx-auto px-4 pt-8">
        <div className="mb-6">
          <Card
            id="header-card"
            className="bg-[#152b56] p-6 text-white dark:bg-[#0a1428]"
          >
            <div className="mb-4 flex items-start justify-between">
              <h1 className="text-2xl font-semibold">Playstyle Analysis</h1>
            </div>
            <p className="text-sm leading-relaxed">
              Deep dive into player behavior patterns, role preferences, and
              playstyle characteristics.
            </p>
          </Card>
        </div>
      </div>

      <div className="container mx-auto px-4 pb-8">
        {isLoading ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <PlaystyleAnalysisSkeleton />
            <PlayerCardSkeleton />
          </div>
        ) : currentPlayer ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Suspense fallback={<PlaystyleAnalysisSkeleton />}>
              <PlaystyleAnalysis
                puuid={currentPlayer.puuid}
                matchCount={currentPlayer.total_matches}
                analyzedMatchCount={currentPlayer.analyzed_matches}
              />
            </Suspense>
            <Suspense fallback={<PlayerCardSkeleton />}>
              <PlayerCard player={currentPlayer} />
            </Suspense>
          </div>
        ) : (
          <Card>
            <CardContent className="flex min-h-72 flex-col items-center justify-center gap-4 text-center">
              <UserRoundSearch className="h-16 w-16 text-muted-foreground" />
              <div>
                <h2 className="text-xl font-semibold">Select a player</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Use the sidebar search or a recent tracked player to begin.
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </ProtectedRoute>
  );
}
