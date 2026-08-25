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
import {
  playerContextQueryKey,
  playerQueryKey,
  playerQueryOptions,
} from "../player-query";
import { isPlayerCentricPath, playerRoute } from "../player-routes";
import { usePlayerProfileUpdate } from "../use-player-sync-run";

interface PlayerContextValue {
  currentPlayer: Player | null;
  isLoading: boolean;
  selectPlayer: (player: Player) => Promise<void>;
  /**
   * Switch to a player known only by PUUID — a participant in somebody else's
   * match, who has a `core.players` row but whose `Player` this surface has
   * never fetched.
   *
   * Persisting the choice is left to the `?puuid=` effect below rather than
   * done here, because that effect already has to handle a URL naming a player
   * nobody clicked (a shared link) and it only persists once the row is known
   * to load. Two places writing the current player would race on a switch to a
   * PUUID whose row has since been deleted.
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
  // The player an explicit `selectPlayer` call is currently switching to.
  //
  // `selectPlayer` persists first and navigates second, so there is a commit
  // where the context already names the chosen player while the URL still
  // names the previous one. The persist effect below reads that stale URL as
  // "a link named somebody else" and PUT the *previous* player straight back
  // — the dialog choice was silently reverted. (Historically a third PUT
  // re-corrected it once the URL caught up, which is why the ping-pong went
  // unnoticed; the untracked gate removed that accidental correction for
  // untracked players and surfaced the revert.) While this ref names a
  // player, the effect stands down until the URL catches up to them.
  const pendingExplicitSelectionRef = useRef<string | null>(null);
  const isPlayerRoute = isPlayerCentricPath(pathname);
  // `?puuid=` with nothing after it is not a selection, it is a malformed
  // link -- `searchParams.get` answers `""` for it, and an empty string is
  // truthy enough to reach the URL branch below and suppress the account's
  // saved player. Treat it as absent.
  const urlPuuid = (isPlayerRoute ? searchParams.get("puuid") : null) || null;

  const contextQuery = useQuery({
    queryKey: playerContextQueryKey(user?.id),
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
    // Mid explicit switch: the URL is behind the choice, not ahead of it.
    // Persisting from it here is what reverted the choice. Cleared once the
    // URL names the chosen player (who is already persisted, so nothing else
    // to do); until then every URL value is stale by construction.
    if (pendingExplicitSelectionRef.current !== null) {
      if (urlPuuid === pendingExplicitSelectionRef.current) {
        pendingExplicitSelectionRef.current = null;
      }
      return;
    }
    if (
      !urlPuuid ||
      !urlPlayerQuery.data ||
      // Untracked players are a visit, not a choice: clicking an enemy laner
      // (or following a shared link to one) must not make a stranger every
      // page's default until the next explicit switch — they are not in the
      // sidebar, so there is nowhere to switch back from. `is_tracked` is
      // per-user, and the schema defaults it to false, so an endpoint that
      // omits the field fails safe by not persisting.
      !urlPlayerQuery.data.is_tracked ||
      contextQuery.data?.current_player?.puuid === urlPuuid ||
      persistedUrlPuuidRef.current === urlPuuid
    ) {
      return;
    }
    // The ref stays set on failure. Clearing it retried, and this effect
    // depends on `updateCurrentMutation` — an object `useMutation` replaces on
    // every state transition — so the failure that cleared the ref also re-ran
    // the effect, which mutated again, which failed again: an unbounded PUT
    // loop against a 500 or a dropped connection, with no toast, for as long
    // as the page stayed open. One attempt per PUUID is enough; a choice that
    // did not persist costs the viewer a default on their next visit, not the
    // page they are on.
    persistedUrlPuuidRef.current = urlPuuid;
    updateCurrentMutation.mutate(urlPuuid);
  }, [contextQuery.data, updateCurrentMutation, urlPlayerQuery.data, urlPuuid]);

  const { mutate: startProfileUpdate } = usePlayerProfileUpdate();

  // No profile update here, on purpose. Picking a player from the sidebar or
  // the tracked-players dialog is navigation, which is the contract this
  // provider was built to: `e2e/player-context.spec.ts` asserts a "View" click
  // starts zero sync runs, so that a browse through six tracked players cannot
  // spend six Riot fetches. `selectPlayerByPuuid` below is the deliberate
  // exception.
  const selectPlayer = useCallback(
    async (player: Player) => {
      pendingExplicitSelectionRef.current = player.puuid;
      try {
        await updateCurrentMutation.mutateAsync(player.puuid);
      } catch (error) {
        // A failed persist never navigates, so the URL will not catch up and
        // clear the ref — clear it here or every later link-persist would be
        // suppressed for the rest of the session.
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

  // `urlPuuid`, not `urlPlayerQuery.data?.puuid`: the row behind the URL is
  // still loading right after a switch, so reading the loaded player would
  // leave this on the *previous* player for as long as the fetch takes — and a
  // second click on the same icon in that window would pass the guard below
  // and start the update twice. The URL is who was chosen whether or not their
  // row has arrived.
  const currentPuuid =
    urlPuuid ?? contextQuery.data?.current_player?.puuid ?? null;

  const selectPlayerByPuuid = useCallback(
    (puuid: string) => {
      // Switching to the player already current would restart their update and
      // push the URL they are already on.
      if (puuid === currentPuuid) return;
      // The exception to the rule above `selectPlayer`. This path is reached
      // only by clicking a participant inside somebody else's match — a player
      // the account very likely does not track and has no stored games for, so
      // navigating without fetching lands on an empty history with nothing
      // said. The run is also what Match History reads to render its
      // progressive-loading state.
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
