"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { unwrap, validatedGet, validatedPost } from "@/lib/core/api";
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
   * Work that has to happen once the run stops, whatever it stopped as.
   *
   * `onCompleted` is the success half; this is for a caller whose own next
   * step is worth taking even after a rate-limited or busy update -- running
   * an analysis over whatever is stored beats leaving the click that asked
   * for it with nothing but an error toast.
   *
   * The outcome comes with it, so a caller acting on a half-failed update can
   * say so rather than presenting stale data as fresh. `"not_started"` is the
   * start the backend refused outright, which has no run and so no status.
   */
  onSettled?:
    | ((
        outcome: PlayerSyncRun["status"] | "not_started",
      ) => void | Promise<void>)
    | undefined;
  /**
   * Say nothing at all: this surface reports the run itself.
   *
   * Not only the started/finished pair. A surface quiet enough to need this
   * renders the run inline, failures included, and the hook's own wording is
   * written for the Player Card -- telling a Rank Manipulation viewer to
   * "try the update again later" names a control that page does not have,
   * and on a failed fetch it arrived directly before a success toast for the
   * comparison that ran anyway.
   */
  quiet?: boolean;
}

/**
 * Track one player's explicit update (`PlayerSyncRun`) from either surface.
 *
 * Owns the whole lifecycle: adopting an in-flight run after navigation or
 * reload via `/sync/active`, polling the exact run to its terminal status,
 * starting a new run, lifecycle toasts, and invalidating every cached query
 * for the player once the run completes. Callers render `isUpdating` and call
 * `startSync` — nothing more.
 *
 * `isUpdating` derives from run status rather than local state, so a failed
 * poll can never leave a surface stuck reporting an update that is not
 * happening. Poll errors themselves are reported by the global query-error
 * toast in `components/providers.tsx`.
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
  const handledTerminalSyncIds = useRef(new Set<number>());

  const activeSyncQuery = useQuery({
    queryKey: ["player-sync-active", puuid],
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
    refetchInterval: (query) => (query.state.data ? 1_000 : false),
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
    refetchInterval: (query) =>
      query.state.data?.status === "pending" ||
      query.state.data?.status === "running"
        ? 1_000
        : false,
  });

  const startSyncMutation = useMutation({
    mutationFn: async () => {
      return unwrap(
        await validatedPost(PlayerSyncRunSchema, `/players/${puuid}/sync`),
      );
    },
    onSuccess: (syncRun) => {
      // The start endpoint attaches to an existing active run rather than
      // erroring, so a second click (or a run started on another surface)
      // returns a run this hook did not start — say so instead of claiming
      // a new update began.
      const attached =
        observedSyncId === syncRun.id ||
        activeSyncQuery.data?.id === syncRun.id;
      setObservedSync({ puuid, id: syncRun.id });
      queryClient.setQueryData(["player-sync-active", puuid], syncRun);
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
    onError: () => {
      if (!quiet) {
        toast.error("Player profile update could not start", {
          description: "Please try again later.",
        });
      }
      // No run exists to reach `finishRun`, so this is the only place the
      // caller's next step can be released after a refused start.
      void onSettled?.("not_started");
    },
  });

  // An effect event, not the effect body: everything below reads
  // `activeSyncQuery`, `onCompleted`, `queryClient` and `toast`, none of which
  // are stable, so as a dependency list they re-ran this effect on every
  // render and only the Set below stopped it acting twice.
  const finishRun = useEffectEvent(async (syncRun: PlayerSyncRun) => {
    if (syncRun.status !== "completed") {
      const rateLimited = syncRun.status === "rate_limited";
      if (!quiet) {
        toast[rateLimited ? "warning" : "error"](
          "Player update did not finish",
          {
            description: rateLimited
              ? "Riot temporarily limited requests. Please try the update again later."
              : "Please try the update again later.",
          },
        );
      }
      await activeSyncQuery.refetch();
      await onSettled?.(syncRun.status);
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
    await activeSyncQuery.refetch();
    await onSettled?.(syncRun.status);
  });

  const syncRun = exactSyncQuery.data;
  useEffect(() => {
    if (
      !syncRun ||
      syncRun.status === "pending" ||
      syncRun.status === "running" ||
      // The completion body refetches this very query. Structural sharing
      // usually hands back the identical object, so the effect does not
      // re-enter -- but that holds only while `PlayerSyncRunSchema` stays a
      // flat object of strings and numbers. One field that moves after
      // terminal status turns this into a toast-and-refetch loop, and this
      // Set is what makes that impossible rather than merely unlikely.
      handledTerminalSyncIds.current.has(syncRun.id)
    ) {
      return;
    }
    handledTerminalSyncIds.current.add(syncRun.id);
    void finishRun(syncRun);
  }, [syncRun]);

  const syncStatus: PlayerSyncRun["status"] | undefined =
    exactSyncQuery.data?.status ?? activeSyncQuery.data?.status;
  const isUpdating =
    startSyncMutation.isPending ||
    syncStatus === "pending" ||
    syncStatus === "running";

  return {
    isUpdating,
    syncStatus,
    startSync: () => startSyncMutation.mutate(),
  };
}
