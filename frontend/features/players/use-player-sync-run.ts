"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  normalizeApiError,
  unwrap,
  validatedGet,
  validatedPost,
} from "@/lib/core/api";
import { useToast } from "@/lib/core/hooks";
import { PlayerSyncRun, PlayerSyncRunSchema } from "@/lib/core/schemas";

interface UsePlayerSyncRunOptions {
  /**
   * Surface-specific refresh work for a completed run (e.g. `router.refresh()`
   * or refreshing sibling cards). Queries whose keys include the PUUID are
   * already invalidated and refetched by the hook itself.
   */
  onCompleted?: (() => void | Promise<void>) | undefined;
  /**
   * Work that has to happen once the run stops, whatever it stopped as. The
   * run comes with it, so a caller can quote the backend's own sentence rather
   * than inventing one. `null` is a start refused outright: no run.
   */
  onSettled?: ((run: PlayerSyncRun | null) => void | Promise<void>) | undefined;
  /**
   * Raise none of this hook's own toasts: the surface reports the run itself,
   * failures included, and two accounts of one click contradict each other.
   * Poll failures come from the queries, where the global toast reports them.
   */
  quiet?: boolean;
}

// Not exported: both readers are in this file, and knip counts an export
// nothing imports as dead code.
function playerSyncActiveQueryKey(puuid: string) {
  return ["player-sync-active", puuid] as const;
}

interface ProfileUpdateStart {
  puuid: string;
  quiet?: boolean | undefined;
}

/**
 * Start one player's profile update, or attach to the run already going.
 * Switching player has to start the *target* player's update before any hook
 * exists for that PUUID; seeding `player-sync-active` here lets it adopt it.
 */
export function usePlayerProfileUpdate({
  onStartRefused,
}: {
  /**
   * The start was refused, so nothing will ever poll to a terminal status and
   * a waiting caller is released here or not at all. An option on the mutation:
   * React Query re-reads those from the latest render, `mutate()`'s are not.
   */
  onStartRefused?: ((puuid: string) => void) | undefined;
} = {}) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: async ({ puuid }: ProfileUpdateStart) => {
      return unwrap(
        await validatedPost(PlayerSyncRunSchema, `/players/${puuid}/sync`),
      );
    },
    onSuccess: (syncRun, { puuid, quiet }) => {
      // The start endpoint attaches to an existing active run rather than
      // erroring, so the cached active run has to be read before it is
      // overwritten to tell a second click from a first.
      const attached =
        queryClient.getQueryData<PlayerSyncRun | null>(
          playerSyncActiveQueryKey(puuid),
        )?.id === syncRun.id;
      queryClient.setQueryData(playerSyncActiveQueryKey(puuid), syncRun);
      if (quiet) {
        return;
      }
      if (attached) {
        toast.info("Player update already in progress", {
          description: "Watching the update that is already running.",
        });
      } else {
        toast.info("Player profile update started", {
          description: "Player data is refreshing in the background.",
        });
      }
    },
    onError: (error, { puuid, quiet }) => {
      if (!quiet) {
        const apiError = normalizeApiError(error);
        if (apiError.code === "SYNC_BUSY") {
          // A refusal, not a failure: the pipeline is busy with another
          // update, no run was created, and the backend's sentence names
          // who is running. The click still lands on stored data.
          toast.info("Player update not started", {
            description: apiError.message,
          });
        } else {
          toast.error("Player profile update could not start", {
            description: "Please try again later.",
          });
        }
      }
      onStartRefused?.(puuid);
    },
  });
}

/**
 * Track one player's explicit update from either surface: adopt, poll, start,
 * toast, invalidate. `isUpdating` is not read from run status alone -- the
 * last good status survives a failed poll, which reports an update forever.
 */
export function usePlayerSyncRun(
  puuid: string,
  { onCompleted, onSettled, quiet = false }: UsePlayerSyncRunOptions = {},
) {
  const queryClient = useQueryClient();
  const toast = useToast();
  // The run id is stored with its PUUID so a surface that re-renders with a
  // different player (an unkeyed PlayerCard after a switch) cannot poll the
  // previous player's run and 404.
  const [observedSync, setObservedSync] = useState<{
    puuid: string;
    id: number;
  } | null>(null);
  // Only "this run reached a terminal status" is tracked. Tracking a failing
  // poll too settled the caller with `null`, but the poll does not stop on an
  // error, so that fired on every blip.
  const handledTerminalSyncIds = useRef(new Set<number>());

  const activeSyncQuery = useQuery({
    queryKey: playerSyncActiveQueryKey(puuid),
    queryFn: async () => {
      return unwrap(
        await validatedGet(
          PlayerSyncRunSchema.nullable(),
          `/players/${puuid}/sync/active`,
        ),
      );
    },
    // The card on Rank Manipulation renders before a player is chosen, and
    // `/players//sync/active` is a 404 the global query-error toast would
    // report on every such mount.
    enabled: puuid !== "",
    refetchInterval: (query) =>
      query.state.data
        ? query.state.fetchFailureCount > 0
          ? 15_000
          : 1_000
        : false,
  });

  // Adopt whatever run `/sync/active` reports, during render: the guard is
  // false on the immediate re-render, so it converges without a commit.
  const activeSyncId = activeSyncQuery.data?.id;
  const observedSyncId = observedSync?.puuid === puuid ? observedSync.id : null;
  if (activeSyncId && activeSyncId !== observedSyncId) {
    setObservedSync({ puuid, id: activeSyncId });
  }

  const exactSyncQuery = useQuery({
    queryKey: ["player-sync", puuid, observedSyncId],
    queryFn: async () => {
      return unwrap(
        await validatedGet(
          PlayerSyncRunSchema,
          `/players/${puuid}/sync/${observedSyncId}`,
        ),
      );
    },
    enabled: observedSyncId !== null,
    // Polls until a terminal status is actually *read*, backing off rather
    // than stopping once it fails. Backed off because `data` survives an error;
    // not stopped because this is the only thing that settles the run.
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      const readTerminalStatus =
        status !== undefined && status !== "pending" && status !== "running";
      if (readTerminalStatus) {
        return false;
      }
      return query.state.fetchFailureCount > 0 ? 15_000 : 1_000;
    },
  });

  const profileUpdate = usePlayerProfileUpdate({
    onStartRefused: () => {
      void onSettled?.(null);
    },
  });

  // An effect event, not the effect body: everything below reads
  // `activeSyncQuery`, `onCompleted`, `queryClient` and `toast`, none of which
  // are stable, so as a dependency list they re-run this effect on every render.
  const finishRun = useEffectEvent(async (syncRun: PlayerSyncRun) => {
    // The refetch and the settle are in the `finally` below rather than at
    // each exit, so a caller waiting on `onSettled` is released exactly once
    // however this ends -- including a throw from the refresh work.
    try {
      if (syncRun.status !== "completed") {
        const rateLimited = syncRun.status === "rate_limited";
        if (!quiet) {
          // The backend's sentence is the reviewed, client-safe reason
          // (`_failure_from_job`) — "Another data update is already
          // running" beats a generic retry prompt that hides why.
          toast[rateLimited ? "warning" : "error"](
            "Player update did not finish",
            {
              description:
                syncRun.error_message ??
                (rateLimited
                  ? "Riot temporarily limited requests. Please try the update again later."
                  : "Please try the update again later."),
            },
          );
        }
        return;
      }

      // Scoped to this player. Prefix matches without the PUUID would
      // invalidate every cached player, so switching to someone else
      // afterwards would refetch their data too.
      const exactPlayerQuery = (query: { queryKey: readonly unknown[] }) =>
        query.queryKey.includes(puuid);
      try {
        await queryClient.invalidateQueries({
          predicate: exactPlayerQuery,
          refetchType: "none",
        });
        await onCompleted?.();
        await queryClient.refetchQueries(
          { predicate: exactPlayerQuery, type: "active" },
          { throwOnError: true },
        );
        if (!quiet) {
          toast.success("Update finished", {
            description: "All cards were successfully updated.",
          });
        }
      } catch {
        if (!quiet) {
          toast.error("Player data could not refresh", {
            description: "Please try again before relying on the card data.",
          });
        }
      }
    } finally {
      await activeSyncQuery.refetch();
      await onSettled?.(syncRun);
    }
  });

  const syncRun = exactSyncQuery.data;
  useEffect(() => {
    if (
      !syncRun ||
      syncRun.status === "pending" ||
      syncRun.status === "running" ||
      // The completion body refetches this very query. Structural sharing
      // usually hands back the identical object, but only while
      // `PlayerSyncRunSchema` stays flat, so this Set forbids the loop.
      handledTerminalSyncIds.current.has(syncRun.id)
    ) {
      return;
    }
    handledTerminalSyncIds.current.add(syncRun.id);
    // Swallowed rather than released: the `finally` inside `finishRun` has
    // already settled the caller by the time anything can reject here, so a
    // rejection only needs keeping from surfacing as an unhandled one.
    void finishRun(syncRun).catch(() => {});
  }, [syncRun]);

  const pollFailed = exactSyncQuery.isError;

  const observedRun = exactSyncQuery.data ?? activeSyncQuery.data;
  const syncStatus: PlayerSyncRun["status"] | undefined = observedRun?.status;
  const isUpdating =
    profileUpdate.isPending ||
    (!pollFailed && (syncStatus === "pending" || syncStatus === "running"));

  return {
    isUpdating,
    /**
     * The run is still in the half that writes matches. A run is Match
     * Fetcher then Player Updater and `match_execution_id` is stamped between
     * the two, so its arrival means every match this run stores is stored.
     */
    isFetchingMatches: isUpdating && !observedRun?.match_execution_id,
    /**
     * Start this player's update. Deliberately takes no target: a defaulted
     * PUUID parameter read as an ordinary optional argument, so every bare
     * `onClick={startSync}` handed React's click event in as the player.
     */
    startSync: () =>
      profileUpdate.mutate(
        { puuid, quiet },
        {
          onSuccess: (syncRun) => setObservedSync({ puuid, id: syncRun.id }),
        },
      ),
  };
}
