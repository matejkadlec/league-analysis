"use client";

import { Suspense } from "react";

import { ProtectedRoute } from "@/features/auth";
import { PageHeader } from "@/components/page-header";
import {
  SectionQuickNavigation,
  type SectionQuickNavigationItem,
} from "@/components/section-quick-navigation";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PlayerSelector,
  SelectPlayerCard,
  useAnalyzedPlayer,
} from "@/features/players";
import {
  SmurfBoostDetection,
  SmurfBoostExplanationCard,
  SmurfBoostSettingsCard,
} from "@/features/smurf-boost";

// `Result` is listed unconditionally on purpose: `SectionQuickNavigation`
// keeps only the entries whose section is actually on the page, so the item
// appears with the result card and not before it.
const RANK_MANIPULATION_NAV_ITEMS: SectionQuickNavigationItem[] = [
  { label: "What This Does", anchor: "#smurf-boost-explanation" },
  { label: "Detection Settings", anchor: "#smurf-boost-settings" },
  { label: "Games Comparison", anchor: "#smurf-boost-run" },
  { label: "Result", anchor: "#smurf-boost-result" },
];

function RankManipulationSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-72" />
      <Skeleton className="h-56" />
    </div>
  );
}

function RankManipulationContent() {
  const { analyzedPlayer, isLoading, selectAnalyzedPlayer } =
    useAnalyzedPlayer();

  return (
    <>
      <SectionQuickNavigation items={RANK_MANIPULATION_NAV_ITEMS} />
      <div className="container mx-auto px-4 py-8">
        <div className="space-y-6">
          <PageHeader title="Rank Manipulation">
            <p className="text-sm leading-relaxed">
              Compare a player&apos;s recent ranked games against their own
              earlier games, and see exactly which areas moved and by how much.
            </p>
          </PageHeader>

          <SmurfBoostExplanationCard />

          {isLoading ? (
            <RankManipulationSkeleton />
          ) : analyzedPlayer ? (
            <>
              <SmurfBoostSettingsCard />
              {/* Keyed by player so a transient failure from one player never
                  survives into another. */}
              <SmurfBoostDetection
                key={analyzedPlayer.puuid}
                puuid={analyzedPlayer.puuid}
                playerSelector={
                  <PlayerSelector
                    id="rank-manipulation-player-search"
                    ariaLabel="Choose player for comparison"
                    placeholder="Search for player"
                    onPlayerSelected={selectAnalyzedPlayer}
                  />
                }
              />
            </>
          ) : (
            // Reached only by an account with no current player at all: the
            // local scope falls back to it, so there is nothing to compare and
            // nothing to search from yet.
            <SelectPlayerCard />
          )}
        </div>
      </div>
    </>
  );
}

export default function RankManipulationPage() {
  return (
    <ProtectedRoute>
      {/* `useAnalyzedPlayer` reads `?puuid=`, which suspends on first render. */}
      <Suspense
        fallback={
          <div className="container mx-auto px-4 py-8">
            <Skeleton className="mb-6 h-32 w-full rounded-lg" />
            <RankManipulationSkeleton />
          </div>
        }
      >
        <RankManipulationContent />
      </Suspense>
    </ProtectedRoute>
  );
}
