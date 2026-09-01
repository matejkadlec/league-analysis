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
  formatRiotId,
  PlayerSelector,
  useAnalyzedPlayer,
} from "@/features/players";
import { Label } from "@/components/ui/label";
import {
  SmurfBoostDetection,
  SmurfBoostExplanationCard,
} from "@/features/smurf-boost";

// `Result` is listed unconditionally; `SectionQuickNavigation` drops entries
// whose section is absent. Detection Settings is a dialog, not a section.
const RANK_MANIPULATION_NAV_ITEMS: SectionQuickNavigationItem[] = [
  { label: "Games Comparison", anchor: "#smurf-boost-run" },
  { label: "Result", anchor: "#smurf-boost-result" },
  { label: "What This Page Does", anchor: "#smurf-boost-explanation" },
];

// One place, because the label's `htmlFor` and the control's `id` are only a
// pair if they are written together.
const PLAYER_SEARCH_ID = "rank-manipulation-player-search";

function RankManipulationSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-72" />
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

          {isLoading ? (
            <RankManipulationSkeleton />
          ) : (
            <>
              {/* No "select a player" card: it would send people to the sidebar
                  search, off this route. Keyed so failures do not carry over. */}
              <SmurfBoostDetection
                key={analyzedPlayer?.puuid ?? "no-player"}
                puuid={analyzedPlayer?.puuid ?? null}
                playerName={analyzedPlayer ? formatRiotId(analyzedPlayer) : null}
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
                      initialSearchValue={
                        analyzedPlayer ? formatRiotId(analyzedPlayer) : ""
                      }
                    />
                  </div>
                }
              />
            </>
          )}

          {/* The reference stays last: someone landing here runs a comparison first. */}
          <SmurfBoostExplanationCard />
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
