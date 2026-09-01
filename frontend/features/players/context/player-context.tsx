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
import { unwrap, validatedGet, validatedPut } from "@/lib/core/http/api";
import {
  PlayerContextSchema,
  type CurrentPlayerUpdate,
  type Player,
} from "@/lib/core/schemas";
import {
  playerContextQueryKey,
  playerQueryKey,
  playerQueryOptions,
} from "../player-query";
import { isPlayerCentricPath, playerRoute } from "../player-routes";
import { usePlayerProfileUpdate } from "../components/use-player-sync-run";

interface PlayerContextValue {
  currentPlayer: Player | null;
  isLoading: boolean;
  selectPlayer: (player: Player) => Promise<void>;
  /**
   * Switch to a player known only by PUUID. Persisting is left to the
   * `?puuid=` effect below; two writers would race on a since-deleted row.
   */
  selectPlayerByPuuid: (puuid: string) => void;
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
  // The player an explicit `selectPlayer` is switching to: it persists first
  // and navigates second, so for one commit the URL still names the previous.
  const pendingExplicitSelectionRef = useRef<string | null>(null);
  const isPlayerRoute = isPlayerCentricPath(pathname);
  // `?puuid=` with nothing after it is a malformed link, not a selection:
  // `""` is truthy enough to reach the URL branch and hide the saved player.
  const urlPuuid = (isPlayerRoute ? searchParams.get("puuid") : null) || null;

  const contextQuery = useQuery({
    queryKey: playerContextQueryKey(user?.id),
    queryFn: async ({ signal }) => {
      const context = unwrap(
        await validatedGet(PlayerContextSchema, "/players/context", { signal }),
      );
      // Seeding here rather than in an effect: children's queries fire before
      // any effect commits, and this turns their `/players/{puuid}` into a hit.
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
    // Only the auth half; the PUUID half is `skipToken` on `queryFn`. Without
    // it a signed-out `/player-overview?puuid=...` visit would probe the API.
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
      queryClient.setQueryData(playerContextQueryKey(user?.id), data);
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
    // `window.history.replaceState` would leave the router unaware, so
    // `useSearchParams` elsewhere returns nothing. No loop: `urlPuuid` is set.
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
    // Mid explicit switch the URL lags the choice, so persisting from it
    // reverts it. Cleared once the URL names the already-persisted choice.
    if (pendingExplicitSelectionRef.current !== null) {
      if (urlPuuid === pendingExplicitSelectionRef.current) {
        pendingExplicitSelectionRef.current = null;
      }
      return;
    }
    if (
      !urlPuuid ||
      !urlPlayerQuery.data ||
      // Untracked players are a visit, not a choice. `is_tracked` defaults to
      // false, so an endpoint that omits it fails safe.
      !urlPlayerQuery.data.is_tracked ||
      contextQuery.data?.current_player?.puuid === urlPuuid ||
      persistedUrlPuuidRef.current === urlPuuid
    ) {
      return;
    }
    // The ref stays set on failure: `useMutation` replaces the dep on every
    // transition, so clearing it means an unbounded PUT loop against a 500.
    persistedUrlPuuidRef.current = urlPuuid;
    updateCurrentMutation.mutate(urlPuuid);
  }, [contextQuery.data, updateCurrentMutation, urlPlayerQuery.data, urlPuuid]);

  const { mutate: startProfileUpdate } = usePlayerProfileUpdate();

  // No profile update here: picking a player from the sidebar is navigation,
  // so browsing six tracked players cannot spend six Riot fetches.
  const selectPlayer = useCallback(
    async (player: Player) => {
      pendingExplicitSelectionRef.current = player.puuid;
      try {
        await updateCurrentMutation.mutateAsync(player.puuid);
      } catch (error) {
        // A failed persist never navigates, so the URL cannot clear the ref;
        // leaving it set would suppress every later link-persist this session.
        pendingExplicitSelectionRef.current = null;
        throw error;
      }
      queryClient.setQueryData(playerQueryKey(player.puuid), player);
      router.push(
        playerRoute(pathname, new URLSearchParams(searchParams), player.puuid),
        { scroll: false },
      );
    },
    [pathname, queryClient, router, searchParams, updateCurrentMutation],
  );

  // `urlPuuid`, not `urlPlayerQuery.data?.puuid`: right after a switch the row
  // is still loading, so the loaded player lags one selection behind.
  const currentPuuid =
    urlPuuid ?? contextQuery.data?.current_player?.puuid ?? null;

  const selectPlayerByPuuid = useCallback(
    (puuid: string) => {
      // Switching to the player already current would restart their update and
      // push the URL they are already on.
      if (puuid === currentPuuid) return;
      // The exception to the rule above `selectPlayer`: this player has no
      // stored games, so navigating alone would land on empty history.
      startProfileUpdate({ puuid });
      router.push(
        playerRoute(pathname, new URLSearchParams(searchParams), puuid),
        { scroll: false },
      );
    },
    [currentPuuid, pathname, router, searchParams, startProfileUpdate],
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
      selectPlayerByPuuid,
    }),
    [
      authLoading,
      contextQuery.data,
      contextQuery.isLoading,
      selectPlayer,
      selectPlayerByPuuid,
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
