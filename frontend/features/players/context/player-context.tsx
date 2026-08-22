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
import { unwrap, validatedGet, validatedPut } from "@/lib/core/api";
import {
  PlayerContextSchema,
  type CurrentPlayerUpdate,
  type Player,
} from "@/lib/core/schemas";
import { playerQueryKey, playerQueryOptions } from "../player-query";
import { isPlayerCentricPath, playerRoute } from "../player-routes";

const PLAYER_CONTEXT_QUERY_KEY = ["player-context"] as const;

interface PlayerContextValue {
  currentPlayer: Player | null;
  isLoading: boolean;
  selectPlayer: (player: Player) => Promise<void>;
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
  // `?puuid=` with nothing after it is not a selection, it is a malformed
  // link -- `searchParams.get` answers `""` for it, and an empty string is
  // truthy enough to reach the URL branch below and suppress the account's
  // saved player. Treat it as absent.
  const urlPuuid = (isPlayerRoute ? searchParams.get("puuid") : null) || null;

  const contextQuery = useQuery({
    queryKey: [...PLAYER_CONTEXT_QUERY_KEY, user?.id],
    queryFn: async () => {
      const context = unwrap(
        await validatedGet(PlayerContextSchema, "/players/context"),
      );
      // This response carries the whole current player, and every route then
      // asks `/players/{puuid}` for that same row -- the player-centric ones
      // through a `?puuid=` this provider puts in the URL from this very
      // response, Rank Manipulation and Matchmaking Analysis through
      // `useAnalyzedPlayer`, whose default target *is* this player. Seeding
      // the player cache turns that second request into a cache hit; only an
      // explicit `?puuid=` naming somebody else still costs a round trip.
      //
      // Here rather than in an effect because an effect is too late: the
      // children re-render the moment this resolves and their queries fire
      // during that render, before any effect commits. Written from the
      // `queryFn` it lands with the data.
      if (context.current_player) {
        queryClient.setQueryData(
          playerQueryKey(context.current_player.puuid),
          context.current_player,
        );
      }
      return context;
    },
    enabled: isAuthenticated && !!user?.id,
  });

  const urlPlayerQuery = useQuery({
    ...playerQueryOptions(urlPuuid),
    // Only the auth half: the PUUID half now lives on `queryFn` as
    // `skipToken`. Keeping this is not redundancy -- `playerQueryOptions`
    // carries no auth gate, and a signed-out visit to
    // `/player-overview?puuid=...` would otherwise probe the API.
    enabled: isAuthenticated,
  });

  const updateCurrentMutation = useMutation({
    mutationFn: async (puuid: string) => {
      return unwrap(
        await validatedPut(PlayerContextSchema, "/players/context/current", {
          puuid,
        } satisfies CurrentPlayerUpdate),
      );
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
    // `window.history.replaceState` would put the PUUID in the address bar
    // without telling the router, so `useSearchParams` elsewhere keeps
    // returning nothing and the sidebar builds every link without the player.
    // This cannot loop: the effect returns early once `urlPuuid` is set.
    router.replace(nextUrl, { scroll: false });
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

  const value = useMemo<PlayerContextValue>(
    () => ({
      currentPlayer:
        urlPuuid !== null
          ? (urlPlayerQuery.data ?? null)
          : (contextQuery.data?.current_player ?? null),
      // No `!!urlPuuid &&` guard: React Query v5 derives isLoading as
      // isPending && isFetching, so the disabled query already reports false.
      isLoading:
        authLoading || contextQuery.isLoading || urlPlayerQuery.isLoading,
      selectPlayer,
    }),
    [
      authLoading,
      contextQuery.data,
      contextQuery.isLoading,
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
