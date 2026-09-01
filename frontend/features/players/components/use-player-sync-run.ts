"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  normalizeApiError,
  unwrap,
  validatedGet,
  validatedPost,
} from "@/lib/core/http/api";
import { useToast } from "@/lib/core/hooks";
import { PlayerSyncRun, PlayerSyncRunSchema } from "@/lib/core/schemas";

interface UsePlayerSyncRunOptions {
  /**
   * Extra refresh work for a completed run; queries keyed by the PUUID are
   * already invalidated and refetched by the hook itself.
   */
  onCompleted?: (() => void | Promise<void>) | undefined;
  /**
   * Runs with the run itself, so a caller can quote the backend's own
   * sentence rather than inventing one; `null` is a start refused outright.
   */
  onSettled?: ((run: PlayerSyncRun | null) => void | Promise<void>) | undefined;
  /**
   * Raise none of this hook's own toasts, failures included -- two accounts of
   * one click contradict each other; poll failures still reach the global toast.
   */
  quiet?: boolean;
}

// Not exported: both readers are in this file, and knip counts an export
// nothing imports as dead code.
function playerSyncActiveQueryKey(puuid: string) {
  return ["player-sync-active", puuid] as const;
}

/**
 * Named rather than inferred: `query-key-scope-contract.test.ts` fails when a
 * new player-derived key skips this list.
 */
export const PLAYER_DERIVED_SYNC_ROOTS = [
  "player",
  "player-league",
  "player-stats",
  "champion-stats",
  "lane-stats",
  "match-history-stats",
  "match-history-detailed",
  // Analyses read the games the update just changed, so their stored answers
  // are about a smaller history than the one now on screen.
  "matchmaking-analysis",
  "matchmaking-analysis-results",
  "matchmaking-analysis-history",
  "matchmaking-analysis-status",
  "smurf-boost-detection",
] as const;

/**
 * The PUUID must sit where its owner puts it: a bare `includes(puuid)` also
 * matches this hook's lifecycle keys and refetches the poll reporting the run.
 */
function isPlayerDerivedQuery(
  queryKey: readonly unknown[],
  puuid: string,
): boolean {
  return (
    typeof queryKey[0] === "string" &&
    (PLAYER_DERIVED_SYNC_ROOTS as readonly string[]).includes(queryKey[0]) &&
    queryKey[1] === puuid
  );
}

interface ProfileUpdateStart {
  puuid: string;
  quiet?: boolean | undefined;
}

/**
 * Seeds `player-sync-active` so a player switch can start the target's update
 * before any hook exists for that PUUID.
 */
export function usePlayerProfileUpdate({
  onStartRefused,
}: {
  /**
   * Nothing polls after a refused start, so a waiting caller is released here.
   * On the mutation: `mutate()`'s options are not re-read from latest render.
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
      // The start endpoint attaches rather than erroring, so the cached run is
      // read before it is overwritten to tell a second click from a first.
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
          // A refusal, not a failure: no run was created, and the backend's
          // sentence names which update is already running.
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
 * `isUpdating` is not read from run status alone: the last good status
 * survives a failed poll, which would report an update forever.
 */
export function usePlayerSyncRun(
  puuid: string,
  { onCompleted, onSettled, quiet = false }: UsePlayerSyncRunOptions = {},
) {
  const queryClient = useQueryClient();
  const toast = useToast();
  // The run id is stored with its PUUID so a surface re-rendered with a
  // different player cannot poll the previous player's run and 404.
  const [observedSync, setObservedSync] = useState<{
    puuid: string;
    id: number;
  } | null>(null);
  // Terminal statuses only: the poll does not stop on an error, so tracking
  // failures here would fire on every blip.
  const handledTerminalSyncIds = useRef(new Set<number>());

  const activeSyncQuery = useQuery({
    queryKey: playerSyncActiveQueryKey(puuid),
    queryFn: async ({ signal }) => {
      return unwrap(
        await validatedGet(
          PlayerSyncRunSchema.nullable(),
          `/players/${puuid}/sync/active`,
          { signal },
        ),
      );
    },
    // Cards render before a player is chosen, and `/players//sync/active` is a
    // 404 the global query-error toast would report on every such mount.
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
    queryFn: async ({ signal }) => {
      return unwrap(
        await validatedGet(
          PlayerSyncRunSchema,
          `/players/${puuid}/sync/${observedSyncId}`,
          { signal },
        ),
      );
    },
    enabled: observedSyncId !== null,
    // Backs off rather than stopping on failure: `data` survives an error, and
    // this poll is the only thing that settles the run.
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

  // An effect event, not the effect body: everything it reads is unstable and
  // as a dependency list would re-run the effect on every render.
  const finishRun = useEffectEvent(async (syncRun: PlayerSyncRun) => {
    // Refetch and settle live in the `finally` so a caller waiting on
    // `onSettled` is released exactly once, however this ends.
    try {
      if (syncRun.status !== "completed") {
        const rateLimited = syncRun.status === "rate_limited";
        if (!quiet) {
          // The backend's sentence is the reviewed, client-safe reason
          // (`_failure_from_job`); a generic retry prompt hides why.
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

      const exactPlayerQuery = (query: { queryKey: readonly unknown[] }) =>
        isPlayerDerivedQuery(query.queryKey, puuid);
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
      // The completion body refetches this very query, and structural sharing
      // only dedupes while the schema stays flat, so this Set forbids the loop.
      handledTerminalSyncIds.current.has(syncRun.id)
    ) {
      return;
    }
    handledTerminalSyncIds.current.add(syncRun.id);
    // Swallowed, not released: `finishRun`'s `finally` has already settled the
    // caller, so a rejection only needs keeping from going unhandled.
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
     * `match_execution_id` lands once the Match Fetcher stopped, successfully
     * or not; the `isUpdating` conjunct is what excludes the failed run.
     */
    isFetchingMatches: isUpdating && !observedRun?.match_execution_id,
    /**
     * Deliberately takes no target: a defaulted PUUID parameter let every bare
     * `onClick={startSync}` pass React's click event in as the player.
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
