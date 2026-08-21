"use client";

import { PageHeader } from "@/components/page-header";
import { ProtectedRoute } from "@/features/auth";
import { MatchHistory, MatchHistoryLoadingCard } from "@/features/matches";
import { SelectPlayerCard, usePlayerContext } from "@/features/players";

export default function MatchHistoryPage() {
  const { currentPlayer, isLoading } = usePlayerContext();

  return (
    <ProtectedRoute>
      <div
        className="container mx-auto min-h-[calc(100dvh+1px)] px-4 py-8"
        data-testid="match-history-page"
      >
        <div className="space-y-6">
          <PageHeader title="Match History">
            <p className="text-sm leading-relaxed">
              Explore player&apos;s matches, queue results, team objectives,
              builds, runes, and performance details.
            </p>
          </PageHeader>

          {isLoading ? (
            <MatchHistoryLoadingCard />
          ) : currentPlayer ? (
            <MatchHistory
              key={currentPlayer.puuid}
              puuid={currentPlayer.puuid}
              lastUpdated={currentPlayer.match_synced_at}
            />
          ) : (
            <SelectPlayerCard />
          )}
        </div>
      </div>
    </ProtectedRoute>
  );
}
