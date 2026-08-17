import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, validatedGet } from "@/lib/core/api";
import { useToast } from "@/lib/core/hooks";
import { PlayerSyncRunSchema } from "@/lib/core/schemas";

export function usePlayerCardSync(
  puuid: string,
  onRefreshAll?: () => void,
) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [observedSyncId, setObservedSyncId] = useState<number | null>(null);
  const handledTerminalSyncIds = useRef<Set<number> | null>(null);
  if (handledTerminalSyncIds.current === null) {
    handledTerminalSyncIds.current = new Set<number>();
  }

  const activeSyncQuery = useQuery({
    queryKey: ["player-sync-active", puuid],
    queryFn: async () => {
      const result = await validatedGet(
        PlayerSyncRunSchema.nullable(),
        `/players/${puuid}/sync/active`,
      );
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    refetchInterval: (query) => (query.state.data ? 1_000 : false),
  });

  useEffect(() => {
    const activeSyncId = activeSyncQuery.data?.id;
    if (!activeSyncId || activeSyncId === observedSyncId) return;
    const timeout = window.setTimeout(() => setObservedSyncId(activeSyncId), 0);
    return () => window.clearTimeout(timeout);
  }, [activeSyncQuery.data?.id, observedSyncId]);

  const exactSyncQuery = useQuery({
    queryKey: ["player-sync", puuid, observedSyncId],
    queryFn: async () => {
      const result = await validatedGet(
        PlayerSyncRunSchema,
        `/players/${puuid}/sync/${observedSyncId}`,
      );
      if (!result.success) throw new Error(result.error.message);
      return result.data;
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
      const response = await api.post(`/players/${puuid}/sync`);
      const parsed = PlayerSyncRunSchema.safeParse(response.data);
      if (!parsed.success) throw new Error("The update response was invalid.");
      return parsed.data;
    },
    onSuccess: (syncRun) => {
      setObservedSyncId(syncRun.id);
      queryClient.setQueryData(["player-sync-active", puuid], syncRun);
      toast({
        title: "Player profile update started",
        description: "Player data is refreshing in the background.",
        variant: "info",
      });
    },
    onError: () => {
      toast({
        title: "Player profile update could not start",
        description: "Please try again later.",
        variant: "error",
      });
    },
  });

  useEffect(() => {
    const syncRun = exactSyncQuery.data;
    if (
      !syncRun ||
      syncRun.status === "pending" ||
      syncRun.status === "running" ||
      handledTerminalSyncIds.current?.has(syncRun.id)
    ) {
      return;
    }
    handledTerminalSyncIds.current?.add(syncRun.id);

    const finish = async () => {
      if (syncRun.status !== "completed") {
        toast({
          title: "Player update did not finish",
          description:
            syncRun.status === "rate_limited"
              ? "Riot temporarily limited requests. Please try the update again later."
              : "Please try the update again later.",
          variant: syncRun.status === "rate_limited" ? "warning" : "error",
        });
        queryClient.setQueryData(["player-sync-active", puuid], null);
        return;
      }

      const exactPlayerQuery = (query: { queryKey: readonly unknown[] }) =>
        query.queryKey.includes(puuid);
      try {
        await queryClient.invalidateQueries({
          predicate: exactPlayerQuery,
          refetchType: "none",
        });
        onRefreshAll?.();
        await queryClient.refetchQueries(
          { predicate: exactPlayerQuery, type: "active" },
          { throwOnError: true },
        );
        toast({
          title: "Update finished",
          description: "All cards were successfully updated.",
          variant: "success",
        });
      } catch {
        toast({
          title: "Player data could not refresh",
          description: "Please try again before relying on the card data.",
          variant: "error",
        });
      }
      queryClient.setQueryData(["player-sync-active", puuid], null);
    };
    void finish();
  }, [exactSyncQuery.data, onRefreshAll, puuid, queryClient, toast]);

  const syncStatus =
    exactSyncQuery.data?.status ?? activeSyncQuery.data?.status;
  const isUpdating =
    startSyncMutation.isPending ||
    syncStatus === "pending" ||
    syncStatus === "running";

  return {
    isUpdating,
    startSync: () => startSyncMutation.mutate(),
  };
}
