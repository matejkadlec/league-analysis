"use client";

import { useState, useEffect, Suspense, useTransition, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Player, PlayerSchema, UserSettingsSchema } from "@/lib/core/schemas";
import { validatedGet, validatedPut } from "@/lib/core/api";
import { PlayerSearch, PlayerCard } from "@/features/players";
import { PlaystyleAnalysis } from "@/features/playstyle-analysis";
import { ProtectedRoute } from "@/features/auth";

import {
  PlayerCardSkeleton,
  PlaystyleAnalysisSkeleton,
} from "@/components/loading-skeleton";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";

export default function PlaystyleAnalysisPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [isPending, startTransition] = useTransition();
  const loadedPuuidRef = useRef<string | null>(null);
  const initialLoadDone = useRef(false);

  // Fetch user settings for URL persistence
  const { data: userSettingsResult } = useQuery({
    queryKey: ["user-settings"],
    queryFn: () => validatedGet(UserSettingsSchema, "/settings/user"),
    staleTime: 60000,
  });

  const userSettings = userSettingsResult?.success
    ? userSettingsResult.data
    : null;

  // Mutation to save PUUID to user settings
  const savePuuidMutation = useMutation({
    mutationFn: async (puuid: string | null) => {
      const result = await validatedPut(UserSettingsSchema, "/settings/user", {
        saved_playstyle_puuid: puuid,
      });
      if (!result.success) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-settings"] });
    },
  });

  // Effect to load player from URL or saved settings
  useEffect(() => {
    if (initialLoadDone.current) return;

    const puuidFromUrl = searchParams.get("puuid");

    // Priority 1: Load from URL param
    if (puuidFromUrl && loadedPuuidRef.current !== puuidFromUrl) {
      initialLoadDone.current = true;
      loadedPuuidRef.current = puuidFromUrl;

      startTransition(() => {
        validatedGet(PlayerSchema, `/players/${puuidFromUrl}`)
          .then((result) => {
            if (result.success) {
              setSelectedPlayer(result.data);
            } else {
              toast.error("Failed to load player data");
              loadedPuuidRef.current = null;
            }
          })
          .catch((error) => {
            toast.error(`Error loading player: ${error.message}`);
            loadedPuuidRef.current = null;
          });
      });
      return;
    }

    // Priority 2: Load from saved settings (if no URL param and save_playstyle_url is enabled)
    if (
      !puuidFromUrl &&
      userSettings?.save_playstyle_url &&
      userSettings?.saved_playstyle_puuid
    ) {
      initialLoadDone.current = true;
      const savedPuuid = userSettings.saved_playstyle_puuid;
      loadedPuuidRef.current = savedPuuid;

      startTransition(() => {
        validatedGet(PlayerSchema, `/players/${savedPuuid}`)
          .then((result) => {
            if (result.success) {
              setSelectedPlayer(result.data);
              // Also update URL to show the saved puuid
              router.push(`/playstyle-analysis?puuid=${savedPuuid}`);
            } else {
              loadedPuuidRef.current = null;
            }
          })
          .catch(() => {
            loadedPuuidRef.current = null;
          });
      });
    }
  }, [searchParams, userSettings, router]);

  const handlePlayerFound = (player: Player) => {
    setSelectedPlayer(player);
    // Update URL with PUUID
    router.push(`/playstyle-analysis?puuid=${player.puuid}`);

    // Save PUUID if user has save_playstyle_url enabled
    if (userSettings?.save_playstyle_url) {
      savePuuidMutation.mutate(player.puuid);
    }
  };

  const handleClearPlayer = () => {
    setSelectedPlayer(null);
    loadedPuuidRef.current = null;
    initialLoadDone.current = false;
    router.push("/playstyle-analysis");

    // Clear saved PUUID if user has save_playstyle_url enabled
    if (userSettings?.save_playstyle_url) {
      savePuuidMutation.mutate(null);
    }
  };

  return (
    <ProtectedRoute>
      <div className="container mx-auto px-4 py-8">
        <div className="mb-6 space-y-6">
          {/* Header Card - Full Width */}
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

          {/* Two Column Layout */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Left Column: Player Search + Playstyle Analysis */}
            <div className="space-y-6">
              <PlayerSearch
                onPlayerFound={handlePlayerFound}
                onClear={handleClearPlayer}
                showClear={!!selectedPlayer}
              />
              {(isPending || selectedPlayer) && (
                <>
                  {isPending ? (
                    <PlaystyleAnalysisSkeleton />
                  ) : selectedPlayer ? (
                    <Suspense fallback={<PlaystyleAnalysisSkeleton />}>
                      <PlaystyleAnalysis
                        puuid={selectedPlayer.puuid}
                        matchCount={selectedPlayer.total_matches}
                        analyzedMatchCount={selectedPlayer.analyzed_matches}
                      />
                    </Suspense>
                  ) : null}
                </>
              )}
            </div>

            {/* Right Column: Player Card */}
            <div>
              {isPending ? (
                <PlayerCardSkeleton />
              ) : selectedPlayer ? (
                <Suspense fallback={<PlayerCardSkeleton />}>
                  <PlayerCard player={selectedPlayer} />
                </Suspense>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}
