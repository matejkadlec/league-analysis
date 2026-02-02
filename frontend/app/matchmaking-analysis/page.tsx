"use client";

import { useState, Suspense, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Player, UserSettingsSchema, PlayerSchema } from "@/lib/core/schemas";
import { getPlayerByPuuid, validatedGet, validatedPut } from "@/lib/core/api";
import { PlayerSearch, PlayerCard } from "@/features/players";
import { MatchHistory } from "@/features/matches";
import {
  MatchmakingAnalysis,
  MatchmakingAnalysisResults,
} from "@/features/matchmaking";
import { ProtectedRoute } from "@/features/auth";

import { Card } from "@/components/ui/card";
import {
  PlayerCardSkeleton,
  MatchHistorySkeleton,
} from "@/components/loading-skeleton";

function MatchmakingAnalysisContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const hasLoadedFromUrl = useRef(false);
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
        saved_matchmaking_puuid: puuid,
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
    if (puuidFromUrl && !hasLoadedFromUrl.current) {
      initialLoadDone.current = true;
      hasLoadedFromUrl.current = true;

      getPlayerByPuuid(puuidFromUrl).then((result) => {
        if (result.success) {
          setSelectedPlayer(result.data);
          queryClient.invalidateQueries({
            queryKey: ["matchmaking-analysis-results", puuidFromUrl],
          });
        } else {
          console.error("Failed to load player from URL:", result.error);
          router.push("/matchmaking-analysis", { scroll: false });
        }
      });
      return;
    }

    // Priority 2: Load from saved settings (if no URL param and save_matchmaking_url is enabled)
    if (
      !puuidFromUrl &&
      userSettings?.save_matchmaking_url &&
      userSettings?.saved_matchmaking_puuid
    ) {
      initialLoadDone.current = true;
      const savedPuuid = userSettings.saved_matchmaking_puuid;
      hasLoadedFromUrl.current = true;

      validatedGet(PlayerSchema, `/players/${savedPuuid}`).then((result) => {
        if (result.success) {
          setSelectedPlayer(result.data);
          router.push(`/matchmaking-analysis?puuid=${savedPuuid}`, {
            scroll: false,
          });
        }
      });
    }
  }, [searchParams, userSettings, router, queryClient]);

  const handlePlayerFound = (player: Player) => {
    setSelectedPlayer(player);
    router.push(`/matchmaking-analysis?puuid=${player.puuid}`, {
      scroll: false,
    });

    // Save PUUID if user has save_matchmaking_url enabled
    if (userSettings?.save_matchmaking_url) {
      savePuuidMutation.mutate(player.puuid);
    }
  };

  const handleClearPlayer = () => {
    setSelectedPlayer(null);
    hasLoadedFromUrl.current = false;
    initialLoadDone.current = false;
    router.push("/matchmaking-analysis", { scroll: false });

    // Clear saved PUUID if user has save_matchmaking_url enabled
    if (userSettings?.save_matchmaking_url) {
      savePuuidMutation.mutate(null);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6 space-y-6">
        {/* Header Card - Full Width */}
        <Card
          id="header-card"
          className="bg-[#152b56] p-6 text-white dark:bg-[#0a1428]"
        >
          <div className="mb-4 flex items-start justify-between">
            <h1 className="text-2xl font-semibold">Matchmaking Analysis</h1>
          </div>
          <p className="text-sm leading-relaxed">
            Analyze matchmaking fairness by comparing average winrates of
            teammates vs enemies in recent ranked matches
          </p>
        </Card>

        {/* Two Column Layout */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Left Column: Player Search + Matchmaking Analysis */}
          <div className="space-y-6">
            <PlayerSearch
              onPlayerFound={handlePlayerFound}
              onClear={handleClearPlayer}
              showClear={!!selectedPlayer}
            />
            {selectedPlayer && (
              <>
                <MatchmakingAnalysis puuid={selectedPlayer.puuid} />
                <MatchmakingAnalysisResults puuid={selectedPlayer.puuid} />
              </>
            )}
          </div>

          {/* Right Column: Player Card */}
          <div>
            {selectedPlayer && (
              <Suspense fallback={<PlayerCardSkeleton />}>
                <PlayerCard player={selectedPlayer} />
              </Suspense>
            )}
          </div>
        </div>

        {/* Full Width Match History */}
        {selectedPlayer && (
          <Suspense fallback={<MatchHistorySkeleton />}>
            <MatchHistory
              key={`${selectedPlayer.puuid}-420`}
              puuid={selectedPlayer.puuid}
              queueFilter={420}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}

export default function MatchmakingAnalysisPage() {
  return (
    <ProtectedRoute>
      <Suspense fallback={<div>Loading...</div>}>
        <MatchmakingAnalysisContent />
      </Suspense>
    </ProtectedRoute>
  );
}
