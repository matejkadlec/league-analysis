"use client";

import { PageHeader } from "@/components/page-header";
import { ProtectedRoute } from "@/features/auth";
import { MatchHistory, MatchHistoryLoadingCard } from "@/features/matches";
import { SelectPlayerCard, usePlayerContext } from "@/features/players";

export default function MatchHistoryPage() {
  const { currentPlayer, isLoading, selectPlayerByPuuid } = usePlayerContext();

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
            // Keyed by PUUID: a switch remounts the card, so the previous
            // player's rows, page number and in-flight query cannot survive
            // into the new player's history.
            <MatchHistory
              key={currentPlayer.puuid}
              puuid={currentPlayer.puuid}
              lastUpdated={currentPlayer.match_synced_at}
              onSelectPlayer={selectPlayerByPuuid}
            />
          ) : (
            <SelectPlayerCard />
          )}
        </div>
      </div>
    </ProtectedRoute>
  );
}
