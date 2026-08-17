"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/features/auth";
import { validatedGet, validatedPut } from "@/lib/core/api";
import { PlayerContextSchema, type Player } from "@/lib/core/schemas";
import { playerQueryKey, playerQueryOptions } from "../player-query";
import { isPlayerCentricPath, playerRoute } from "../player-routes";

const PLAYER_CONTEXT_QUERY_KEY = ["player-context"] as const;

interface PlayerContextValue {
  currentPlayer: Player | null;
  trackedPlayers: Player[];
  isLoading: boolean;
  selectPlayer: (player: Player) => Promise<void>;
  refreshContext: () => Promise<void>;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function PlayerContextProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const persistedUrlPuuidRef = useRef<string | null>(null);
  const isPlayerRoute = isPlayerCentricPath(pathname);
  const urlPuuid = isPlayerRoute ? searchParams.get("puuid") : null;

  const contextQuery = useQuery({
    queryKey: [...PLAYER_CONTEXT_QUERY_KEY, user?.id],
    queryFn: async () => {
      const result = await validatedGet(
        PlayerContextSchema,
        "/players/context",
      );
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    enabled: isAuthenticated && !!user?.id,
  });

  const urlPlayerQuery = useQuery({
    ...playerQueryOptions(urlPuuid),
    enabled: isAuthenticated && !!urlPuuid,
  });

  const updateCurrentMutation = useMutation({
    mutationFn: async (puuid: string) => {
      const result = await validatedPut(
        PlayerContextSchema,
        "/players/context/current",
        { puuid },
      );
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData([...PLAYER_CONTEXT_QUERY_KEY, user?.id], data);
    },
  });

  useEffect(() => {
    const savedPlayer = contextQuery.data?.current_player;
    if (!isPlayerRoute || urlPuuid || !savedPlayer) return;
    const nextUrl = playerRoute(
      pathname,
      new URLSearchParams(searchParams),
      savedPlayer.puuid,
    );
    window.history.replaceState(window.history.state, "", nextUrl);
  }, [
    contextQuery.data,
    isPlayerRoute,
    pathname,
    router,
    searchParams,
    urlPuuid,
  ]);

  useEffect(() => {
    if (
      !urlPuuid ||
      !urlPlayerQuery.data ||
      contextQuery.data?.current_player?.puuid === urlPuuid ||
      persistedUrlPuuidRef.current === urlPuuid
    ) {
      return;
    }
    persistedUrlPuuidRef.current = urlPuuid;
    updateCurrentMutation.mutate(urlPuuid, {
      onError: () => {
        persistedUrlPuuidRef.current = null;
      },
    });
  }, [contextQuery.data, updateCurrentMutation, urlPlayerQuery.data, urlPuuid]);

  const selectPlayer = useCallback(
    async (player: Player) => {
      await updateCurrentMutation.mutateAsync(player.puuid);
      queryClient.setQueryData(playerQueryKey(player.puuid), player);
      router.push(
        playerRoute(pathname, new URLSearchParams(searchParams), player.puuid),
        { scroll: false },
      );
    },
    [pathname, queryClient, router, searchParams, updateCurrentMutation],
  );

  const refreshContext = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: [...PLAYER_CONTEXT_QUERY_KEY, user?.id],
    });
  }, [queryClient, user?.id]);

  const value = useMemo<PlayerContextValue>(
    () => ({
      currentPlayer:
        urlPuuid !== null
          ? (urlPlayerQuery.data ?? null)
          : (contextQuery.data?.current_player ?? null),
      trackedPlayers: contextQuery.data?.tracked_players ?? [],
      isLoading:
        authLoading ||
        contextQuery.isLoading ||
        (!!urlPuuid && urlPlayerQuery.isLoading),
      selectPlayer,
      refreshContext,
    }),
    [
      authLoading,
      contextQuery.data,
      contextQuery.isLoading,
      refreshContext,
      selectPlayer,
      urlPlayerQuery.data,
      urlPlayerQuery.isLoading,
      urlPuuid,
    ],
  );

  return (
    <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
  );
}

export function usePlayerContext(): PlayerContextValue {
  const context = useContext(PlayerContext);
  if (!context) {
    throw new Error(
      "usePlayerContext must be used within PlayerContextProvider",
    );
  }
  return context;
}
