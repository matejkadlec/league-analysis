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
   * The run comes with it, so a caller acting on a half-failed update can say
   * so rather than presenting stale data as fresh -- and can quote the
   * backend's own reviewed sentence for the failure instead of inventing a
   * generic one, which for a stale player id or an expired key would promise
   * a retry that cannot work. `null` is a start the backend refused outright,
   * so no run exists to report on. A run that started always settles with
   * itself, however long its status takes to become readable.
   */
  onSettled?: ((run: PlayerSyncRun | null) => void | Promise<void>) | undefined;
  /**
   * Raise none of this hook's own toasts: the surface reports the run itself.
   *
   * Not only the started/finished pair. A surface quiet enough to need this
   * renders the run inline, failures included, and two accounts of one click
   * contradict each other -- on a failed fetch the hook's warning arrived
   * directly before the card's success toast for the comparison that ran
   * anyway. Poll failures are not covered: those come from the queries, and
   * the global query-error toast still reports them.
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
 *
 * Split out of `usePlayerSyncRun` because switching player has to start the
 * *target* player's update from a surface mounted for somebody else, before any
 * hook exists for that PUUID. Seeding `player-sync-active` here is what lets
 * the destination's `usePlayerSyncRun` adopt the run on its first render
 * instead of waiting out a poll — which is also what makes Match History show
 * its progressive-loading state immediately after the switch rather than a
 * second later.
 */
export function usePlayerProfileUpdate({
  onStartRefused,
}: {
  /**
   * The start was refused, so no run exists and nothing will ever poll to a
   * terminal status — a caller waiting on the update has to be released here
   * or not at all.
   *
   * An option on the mutation rather than a callback passed to `mutate()`:
   * React Query re-reads these from the latest render, while the ones handed
   * to `mutate()` are captured at the call. Smurf-boost sets the state its
   * release branches on in the very click that starts the update, and a
   * captured closure released it against the pre-click value.
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
      // erroring, so a second click (or a run started on another surface)
      // returns a run this call did not start — say so instead of claiming a
      // new update began. The cached active run is the record of what was
      // already running, so it has to be read before being overwritten.
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
    onError: (_error, { puuid, quiet }) => {
      if (!quiet) {
        toast.error("Player profile update could not start", {
          description: "Please try again later.",
        });
      }
      onStartRefused?.(puuid);
    },
  });
}

/**
 * Track one player's explicit update (`PlayerSyncRun`) from either surface.
 *
 * Owns the whole lifecycle: adopting an in-flight run after navigation or
 * reload via `/sync/active`, polling the exact run to its terminal status,
 * starting a new run, lifecycle toasts, and invalidating every cached query
 * for the player once the run completes. A caller renders `isUpdating` and
 * calls `startSync`; the options above are for a surface that reports the run
 * itself or has its own next step to take.
 *
 * `isUpdating` derives from run status, but not from status alone: the last
 * good status survives a failed poll, so reading it by itself left a surface
 * reporting an update forever whenever the poll stopped answering. While the
 * poll is failing the honest answer is "not known to be updating" -- the run
 * may well still be going, and if it is, the backed-off poll will say so and
 * this flips back. Poll errors themselves are reported by the global
 * query-error toast in `components/providers.tsx`.
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
  // Only "this run reached a terminal status" is tracked. A failing poll used
  // to be tracked too, and settled the caller with `null` -- but the poll does
  // not stop on an error (see `refetchInterval` below), so that fired on every
  // blip and settled runs that were still going. `tests/
  // player-sync-poll-recovery.test.tsx` pins both halves.
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
    // than stopping once it starts failing. Two things depend on that.
    //
    // Backed off, because `data` survives an error: the status still reads
    // `running`, and without the backoff this would retry every second
    // forever against a dead endpoint.
    //
    // Not stopped, because this is the only thing that ever settles the run.
    // Keying on the last payload alone stopped the poll dead when the *first*
    // read failed -- there is no `data` then, so no status, and a run whose
    // opening poll blipped was never spoken of again.
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
  // are stable, so as a dependency list they re-ran this effect on every
  // render and only the Set below stopped it acting twice.
  const finishRun = useEffectEvent(async (syncRun: PlayerSyncRun) => {
    // The refetch and the settle are in the `finally` below rather than at
    // each exit, so a caller waiting on `onSettled` is released exactly once
    // however this ends -- including a throw from the refresh work.
    try {
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
    // Swallowed rather than released: the `finally` inside `finishRun` has
    // already settled the caller by the time anything can reject here, so the
    // only thing left to do with a rejection is keep it from surfacing as an
    // unhandled one.
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
     * The run is still in the half that writes matches.
     *
     * A run is Match Fetcher then Player Updater, and the backend stamps
     * `match_execution_id` onto it between the two (`jobs/player_sync.py`), so
     * its arrival means every match this run will store is stored. A surface
     * showing "loading more matches" off `isUpdating` alone would keep saying
     * so through the profile half, which writes none.
     */
    isFetchingMatches: isUpdating && !observedRun?.match_execution_id,
    /**
     * Start this player's update.
     *
     * Deliberately takes no target: a surface switching to somebody else calls
     * `usePlayerProfileUpdate` directly, which is what `player-context` does.
     * A defaulted PUUID parameter here read as an ordinary optional argument
     * and meant every bare `onClick={startSync}` handed React's click event in
     * as the player to update.
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
