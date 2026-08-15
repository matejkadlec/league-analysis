"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Clock, Loader2, PlayCircle, Search } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { startSmurfBoostDetection } from "@/lib/core/api";
import { apiErrorMessage } from "@/lib/core/api-error";
import { useToast } from "@/lib/core/hooks";
import { useRelativeTime } from "@/lib/core/use-relative-time";
import type { SmurfBoostAnalysisResponse } from "@/lib/core/schemas";

import { smurfBoostQueryKey, smurfBoostQueryOptions } from "../smurf-boost-query";
import { MINIMUM_BASELINE_GAMES } from "../smurf-boost-settings";
import { SmurfBoostResultCard } from "./smurf-boost-result-card";

// The two statuses the backend uses for a run that has not reached a terminal
// state. A request that arrives while another viewer's identical run is still
// computing is answered with that run, so a start can legitimately return one
// of these instead of a result.
const ACTIVE_STATUSES = ["pending", "in_progress"];

// How often an active run is re-read. The computation finishes inside its own
// request, so an active row seen here belongs to another viewer's request and
// resolves within seconds.
const ACTIVE_POLL_MS = 3000;

function isActive(analysis: SmurfBoostAnalysisResponse | null): boolean {
  return analysis !== null && ACTIVE_STATUSES.includes(analysis.status);
}

interface SmurfBoostDetectionProps {
  puuid: string;
}

function RunCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-56" />
      </CardHeader>
      <CardContent className="space-y-4">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-10 w-full" />
      </CardContent>
    </Card>
  );
}

export function SmurfBoostDetection({ puuid }: SmurfBoostDetectionProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  // A transient failure belongs to the interaction that produced it. The page
  // remounts this card per player, so the state cannot outlive its player.
  const [failure, setFailure] = useState<string | null>(null);

  const {
    data: latest,
    isLoading,
    error,
  } = useQuery({
    ...smurfBoostQueryOptions(puuid),
    refetchInterval: (query) =>
      isActive(query.state.data ?? null) ? ACTIVE_POLL_MS : false,
  });

  const completedAt = latest?.completed_at ?? null;
  const relativeCompletedAt = useRelativeTime(completedAt);

  const runMutation = useMutation({
    mutationFn: async (targetPuuid: string) => {
      const result = await startSmurfBoostDetection(targetPuuid);
      if (!result.success) {
        throw new Error(
          apiErrorMessage(
            result.error,
            "The comparison could not be run. Please try again.",
          ),
        );
      }
      return result.data;
    },
    onMutate: async (targetPuuid: string) => {
      setFailure(null);
      // A refetch started before this run must not resolve afterwards and
      // restore the previous analysis over the new one.
      await queryClient.cancelQueries({
        queryKey: smurfBoostQueryKey(targetPuuid),
      });
    },
    onSuccess: (data) => {
      // The response is stored under the player it describes, never under
      // whichever player happens to be selected when it arrives.
      queryClient.setQueryData(smurfBoostQueryKey(data.puuid), data);
      if (data.puuid !== puuid) {
        return;
      }
      if (data.status === "failed") {
        const message =
          data.error_message ??
          "The comparison did not finish. Please try again.";
        setFailure(message);
        toast.error("Comparison did not finish", { description: message });
        return;
      }
      if (isActive(data)) {
        toast.info("Comparison already running", {
          description:
            "This player is already being compared. The result appears here when it finishes.",
        });
        return;
      }
      toast.success("Comparison complete", {
        description: "The recent games have been compared with the earlier ones.",
      });
    },
    onError: (mutationError: Error) => {
      setFailure(mutationError.message);
      toast.error("Comparison did not run", {
        description: mutationError.message,
      });
    },
  });

  if (isLoading) {
    return <RunCardSkeleton />;
  }

  const running = runMutation.isPending || isActive(latest ?? null);
  const results = latest?.status === "completed" ? latest.results : null;
  const storedFailure =
    latest && latest.status === "failed"
      ? (latest.error_message ??
        "The comparison did not finish. Please try again.")
      : null;

  return (
    <div className="space-y-6">
      <Card id="smurf-boost-run">
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center gap-2">
            <Search className="h-5 w-5 text-primary" />
            Compare recent games with earlier games
            {latest?.is_stale && (
              <Badge variant="outline" className="ml-auto">
                New games since this comparison
              </Badge>
            )}
          </CardTitle>
          {completedAt && (
            <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>Last run {relativeCompletedAt}</span>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This reads only ranked solo/duo games already stored for this
            player. It contacts no external service, so it finishes in one step.
          </p>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                The previous comparison could not be loaded. You can still run a
                new one.
              </AlertDescription>
            </Alert>
          )}

          {(failure ?? storedFailure) && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{failure ?? storedFailure}</AlertDescription>
            </Alert>
          )}

          {isActive(latest ?? null) && (
            <Alert>
              <Loader2 className="h-4 w-4 animate-spin" />
              <AlertDescription>
                A comparison for this player is running. The result appears here
                as soon as it finishes.
              </AlertDescription>
            </Alert>
          )}

          <Button
            className="button-full"
            onClick={() => runMutation.mutate(puuid)}
            disabled={running}
          >
            {running ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Comparing games...
              </>
            ) : (
              <>
                <PlayCircle className="mr-2 h-4 w-4" />
                {results ? "Run the comparison again" : "Run the comparison"}
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {results && latest && (
        <SmurfBoostResultCard
          results={results}
          thresholds={latest.thresholds}
          minimumBaselineGames={MINIMUM_BASELINE_GAMES}
        />
      )}
    </div>
  );
}
