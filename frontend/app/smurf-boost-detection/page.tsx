"use client";

import { ProtectedRoute } from "@/features/auth";
import {
  SectionQuickNavigation,
  type SectionQuickNavigationItem,
} from "@/components/section-quick-navigation";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SelectPlayerCard, usePlayerContext } from "@/features/players";
import {
  SmurfBoostDetection,
  SmurfBoostExplanationCard,
  SmurfBoostSettingsCard,
} from "@/features/smurf-boost";

const SMURF_BOOST_NAV_ITEMS: SectionQuickNavigationItem[] = [
  { label: "What This Does", anchor: "#smurf-boost-explanation" },
  { label: "Settings", anchor: "#smurf-boost-settings" },
  { label: "Run Comparison", anchor: "#smurf-boost-run" },
  { label: "Result", anchor: "#smurf-boost-result" },
];

function SmurfBoostDetectionSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-72" />
      <Skeleton className="h-56" />
    </div>
  );
}

export default function SmurfBoostDetectionPage() {
  const { currentPlayer, isLoading } = usePlayerContext();

  return (
    <ProtectedRoute>
      {currentPlayer && (
        <SectionQuickNavigation items={SMURF_BOOST_NAV_ITEMS} />
      )}
      <div className="container mx-auto px-4 py-8">
        <div className="space-y-6">
          <Card id="header-card" className="p-6 text-white">
            <h1 className="text-2xl font-semibold">Smurf &amp; Boost Detection</h1>
            <p className="mt-4 text-sm leading-relaxed">
              Compare a player&apos;s recent ranked games against their own
              earlier games, and see exactly which areas moved and by how much.
            </p>
          </Card>

          <SmurfBoostExplanationCard />

          {isLoading ? (
            <SmurfBoostDetectionSkeleton />
          ) : currentPlayer ? (
            <>
              <SmurfBoostSettingsCard />
              {/* Keyed by player so a transient failure from one player never
                  survives into another. */}
              <SmurfBoostDetection
                key={currentPlayer.puuid}
                puuid={currentPlayer.puuid}
              />
            </>
          ) : (
            <SelectPlayerCard />
          )}
        </div>
      </div>
    </ProtectedRoute>
  );
}
