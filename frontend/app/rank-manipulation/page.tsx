"use client";

import { Suspense } from "react";

import { ProtectedRoute } from "@/features/auth";
import { PageHeader } from "@/components/page-header";
import {
  SectionQuickNavigation,
  type SectionQuickNavigationItem,
} from "@/components/section-quick-navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { PlayerSelector, useAnalyzedPlayer } from "@/features/players";
import { Label } from "@/components/ui/label";
import {
  SmurfBoostDetection,
  SmurfBoostExplanationCard,
  SmurfBoostSettingsCard,
} from "@/features/smurf-boost";

// `Result` is listed unconditionally on purpose: `SectionQuickNavigation`
// keeps only the entries whose section is actually on the page, so the item
// appears with the result card and not before it.
const RANK_MANIPULATION_NAV_ITEMS: SectionQuickNavigationItem[] = [
  { label: "What This Page Does", anchor: "#smurf-boost-explanation" },
  { label: "Detection Settings", anchor: "#smurf-boost-settings" },
  { label: "Games Comparison", anchor: "#smurf-boost-run" },
  { label: "Result", anchor: "#smurf-boost-result" },
];

// One place, because the label's `htmlFor` and the control's `id` are only a
// pair if they are written together.
const PLAYER_SEARCH_ID = "rank-manipulation-player-search";

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
          ) : (
            <>
              <SmurfBoostSettingsCard />
              {/* Rendered with no player too, rather than swapped for a
                  "select a player" card. That card sends people to the sidebar
                  search, which is a current-player surface: on a route that is
                  no longer player-centric it navigates away to Player
                  Overview, so the one page that needs a local target had no
                  way to set one. Reachable with no player two ways -- an
                  account that has never chosen one, and a `?puuid=` that will
                  not load. Keyed by player so a transient failure from one
                  never survives into another. */}
              <SmurfBoostDetection
                key={analyzedPlayer?.puuid ?? "no-player"}
                puuid={analyzedPlayer?.puuid ?? null}
                playerSelector={
                  <div className="space-y-1.5">
                    <Label htmlFor={PLAYER_SEARCH_ID}>
                      Choose player for comparison
                    </Label>
                    <PlayerSelector
                      id={PLAYER_SEARCH_ID}
                      ariaLabel="Choose player for comparison"
                      placeholder="Search for player"
                      onPlayerSelected={selectAnalyzedPlayer}
                    />
                  </div>
                }
              />
            </>
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
