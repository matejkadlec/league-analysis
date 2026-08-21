"use client";

import { useCallback, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import type { Player } from "@/lib/core/schemas";

import { usePlayerContext } from "./context/player-context";
import { playerQueryKey, playerQueryOptions } from "./player-query";

/**
 * A tab-local player scope for pages that analyze a player of their own
 * choosing without touching global context or tracking.
 *
 * The analyzed PUUID is the explicit `?puuid=` when present, otherwise the
 * account's saved current player as the initial default. Seeding the default
 * into the URL goes through `router.replace`, not `window.history.replaceState`:
 * a raw history write hides the PUUID from every other `useSearchParams`
 * reader, so sidebar links and route state silently disagree with the address
 * bar. The effect cannot loop -- it returns early once the URL carries one.
 */
export function useAnalyzedPlayer(): {
  analyzedPlayer: Player | null;
  isLoading: boolean;
  selectAnalyzedPlayer: (player: Player) => void;
} {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const {
    currentPlayer: referencePlayer,
    isLoading: isLoadingReference,
  } = usePlayerContext();

  // `?puuid=` with nothing after it is malformed, not a selection; treat it
  // as absent exactly like the provider does for player-centric routes.
  const urlPuuid = searchParams.get("puuid") || null;

  const analyzedPuuid = urlPuuid ?? referencePlayer?.puuid ?? null;
  const { data: analyzedPlayer, isLoading: isLoadingAnalyzed } = useQuery(
    playerQueryOptions(analyzedPuuid),
  );

  useEffect(() => {
    if (urlPuuid || !referencePlayer) return;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("puuid", referencePlayer.puuid);
    router.replace(`${pathname}?${nextParams.toString()}`, { scroll: false });
  }, [pathname, referencePlayer, router, searchParams, urlPuuid]);

  const selectAnalyzedPlayer = useCallback(
    (player: Player) => {
      queryClient.setQueryData(playerQueryKey(player.puuid), player);
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("puuid", player.puuid);
      router.push(`${pathname}?${nextParams.toString()}`, { scroll: false });
    },
    [pathname, queryClient, router, searchParams],
  );

  return {
    analyzedPlayer: analyzedPlayer ?? null,
    isLoading: isLoadingReference || isLoadingAnalyzed,
    selectAnalyzedPlayer,
  };
}
