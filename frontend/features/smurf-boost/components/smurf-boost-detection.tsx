"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Loader2, PlayCircle, Search } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { startSmurfBoostDetection } from "../smurf-boost-api";
import { apiErrorMessage } from "@/lib/core/api-error";
import { UpdatedStamp } from "@/features/profile";
import { useToast } from "@/lib/core/hooks";
import type { SmurfBoostAnalysisResponse } from "@/lib/core/schemas";

import {
  smurfBoostQueryKey,
  smurfBoostQueryOptions,
} from "../smurf-boost-query";
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
  /**
   * The player being compared, or `null` when none is chosen yet.
   *
   * Nullable so the card -- and the search inside it -- render before there
   * is a target. The alternative was a separate empty-state card, which would
   * have meant a second copy of the approved wording and a second place to
   * forget the search.
   */
  puuid: string | null;
  /**
   * The page's local player search, label and all, rendered inside this card
   * above the run action.
   *
   * The card takes it as a node rather than reaching for the scope itself:
   * choosing the analysed player is the page's business, and passing the
   * control in keeps this component driven by the one `puuid` it compares.
   * The label comes with it because the page owns the control's `id` -- a
   * `htmlFor` hardcoded here would silently orphan itself the first time a
   * second caller passed a differently identified control.
   */
  playerSelector: ReactNode;
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

export function SmurfBoostDetection({
  puuid,
  playerSelector,
}: SmurfBoostDetectionProps) {
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
    // Cache only. Anything the viewer sees belongs to the `mutate` call
    // below: these options-level callbacks live on the mutation, not on this
    // component, so they still run after it unmounts -- and switching player
    // in the card's own search unmounts it. The `data.puuid !== puuid` guard
    // that used to sit here read the *unmounted* closure's player, matched,
    // and toasted "Comparison complete" over whoever was on screen by then.
    onSuccess: (data) => {
      // The response is stored under the player it describes, never under
      // whichever player happens to be selected when it arrives.
      queryClient.setQueryData(smurfBoostQueryKey(data.puuid), data);
    },
  });

  // Feedback for the run this card started, skipped by react-query once the
  // card is gone. A run whose player was switched away from still lands in the
  // cache above, so switching back shows its outcome.
  const runComparison = (targetPuuid: string) => {
    runMutation.mutate(targetPuuid, {
      onSuccess: (data) => {
        // Compared against the player this run asked about, not against the
        // card's current one: these callbacks already stop firing once the
        // card is gone, so what is left to catch is a server answering about
        // somebody else. Saying "comparison complete" over a result that
        // describes another player would be a lie either way.
        if (data.puuid !== targetPuuid) {
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
          description:
            "The recent games have been compared with the earlier ones.",
        });
      },
      onError: (mutationError: Error) => {
        setFailure(mutationError.message);
        toast.error("Comparison did not run", {
          description: mutationError.message,
        });
      },
    });
  };

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
      {/* Half the content width on desktop, with the second column left empty
          on purpose -- the comparison is one button and a search, and filling
          the space would mean inventing a card nobody asked for. */}
      <div
        id="smurf-boost-comparison-row"
        className="grid grid-cols-1 gap-6 lg:grid-cols-2"
      >
        <Card id="smurf-boost-run">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="flex items-center gap-2">
                <Search className="h-5 w-5 text-primary" />
                Games Comparison
              </CardTitle>
              {latest?.is_stale && (
                <Badge variant="outline" className="ml-auto">
                  New games since this comparison
                </Badge>
              )}
            </div>
            <UpdatedStamp
              lastUpdated={completedAt}
              label="Last run"
              className="mt-2 text-sm text-muted-foreground"
            />
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Compare recent games with earlier games. This reads only ranked
              solo/duo games already stored for this player. It contacts no
              external service, so it finishes in one step.
            </p>

            {playerSelector}

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  The previous comparison could not be loaded. You can still run
                  a new one.
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
                  A comparison for this player is running. The result appears
                  here as soon as it finishes.
                </AlertDescription>
              </Alert>
            )}

            <Button
              className="button-full"
              onClick={() => puuid && runComparison(puuid)}
              disabled={running || !puuid}
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
      </div>

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
