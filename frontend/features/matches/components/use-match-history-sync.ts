"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { PlayerSyncRunSchema } from "@/lib/core/schemas";
import { validatedGet, api } from "@/lib/core/api";
import { useToast } from "@/lib/core/hooks";
import { playerQueryKey } from "@/features/players";

export function useMatchHistorySync(puuid: string) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const router = useRouter();

  const [isStarting, setIsStarting] = useState(false);
  const [syncRunId, setSyncRunId] = useState<number | null>(null);
  const isUpdating = isStarting || syncRunId !== null;
  const handledSyncRunIds = useRef<Set<number> | undefined>(undefined);

  // The update used to refetch behind `setTimeout(..., 5000)`, which was a
  // guess at how long the backend takes. Under a slow sync it refetched into
  // half-written data and stopped; over a fast one it idled. The run says when
  // it is done, so ask it.
  //
  // ponytail: this repeats the run tracking in player-card.tsx. Worth
  // extracting a shared `usePlayerSyncRun` hook once a third surface needs it.
  const syncRunQuery = useQuery({
    queryKey: ["player-sync", puuid, syncRunId],
    queryFn: async () => {
      const result = await validatedGet(
        PlayerSyncRunSchema,
        `/players/${puuid}/sync/${syncRunId}`,
      );
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    enabled: syncRunId !== null,
    refetchInterval: (query) =>
      query.state.data?.status === "pending" ||
      query.state.data?.status === "running"
        ? 1_000
        : false,
  });

  useEffect(() => {
    let cancelled = false;
    const handledIds = (handledSyncRunIds.current ??= new Set<number>());
    const syncRun = syncRunQuery.data;
    if (
      !syncRun ||
      syncRun.status === "pending" ||
      syncRun.status === "running" ||
      // The run keeps returning its terminal status until the id is cleared,
      // so without this the effect re-enters and refetches on every poll.
      handledIds.has(syncRun.id)
    ) {
      return () => {
        cancelled = true;
      };
    }
    handledIds.add(syncRun.id);

    const finish = async () => {
      if (syncRun.status !== "completed") {
        if (cancelled) {
          return;
        }
        toast.error("Player profile update did not finish", {
          description:
            syncRun.status === "rate_limited"
              ? "Riot temporarily limited requests. Please try again later."
              : "Please try the update again later.",
        });
        setSyncRunId(null);
        return;
      }

      await Promise.all([
        // Invalidate the current player's detailed history instead of calling
        // refetch() from this effect. Prefixing with PUUID keeps the refresh
        // scoped to this player.
        queryClient.invalidateQueries({
          queryKey: ["matchHistoryDetailed", puuid],
        }),
        queryClient.invalidateQueries({ queryKey: playerQueryKey(puuid) }),
        queryClient.invalidateQueries({
          queryKey: ["player-league", puuid],
        }),
        queryClient.invalidateQueries({
          queryKey: ["player-stats", puuid],
        }),
      ]);
      if (cancelled) {
        return;
      }
      router.refresh();
      setSyncRunId(null);
    };
    void finish();

    return () => {
      cancelled = true;
    };
  }, [syncRunQuery.data, puuid, queryClient, router, toast]);

  const handleUpdate = async () => {
    setIsStarting(true);
    try {
      // `/players/{puuid}/sync` runs the same Match Fetcher then Player
      // Updater pair as the older `/jobs/sync-player/{puuid}` route, but
      // returns a run this component can actually watch to completion.
      const response = await api.post(`/players/${puuid}/sync`);
      const parsed = PlayerSyncRunSchema.safeParse(response.data);
      if (!parsed.success) {
        throw new Error("The update response was invalid.");
      }

      toast.info("Player profile update started", {
        description: "Match and rank data are refreshing in the background.",
      });
      setSyncRunId(parsed.data.id);
    } catch {
      toast.error("Player profile update could not start", {
        description: "Please try again later.",
      });
    } finally {
      setIsStarting(false);
    }
  };

  return { isUpdating, handleUpdate };
}
