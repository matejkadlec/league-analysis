"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Download, Loader2, PlayCircle, Search } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { startSmurfBoostDetection } from "../smurf-boost-api";
import { unwrap } from "@/lib/core/http/api";
import { apiErrorMessage, normalizeApiError } from "@/lib/core/http/api-error";
import { UpdatedStamp } from "@/components/updated-stamp";
import { playerStatsQueryOptions, usePlayerSyncRun } from "@/features/players";
import { useToast } from "@/lib/core/hooks";
import type { SmurfBoostAnalysisResponse } from "@/lib/core/schemas";

import {
  smurfBoostQueryKey,
  smurfBoostQueryOptions,
} from "../smurf-boost-query";
import { gameShortfall } from "../smurf-boost-settings";
import { SmurfBoostResultCard } from "./smurf-boost-result-card";
import { SmurfBoostSettingsDialog } from "./smurf-boost-settings-dialog";

// A run belongs to the account that asked for it, so a start returns one of
// these only when this account already has one in flight, and attaches to it.
const ACTIVE_STATUSES = ["pending", "in_progress"];

// The computation finishes inside its own request, so an active row here is
// another in-flight request of this account and resolves within seconds.
const ACTIVE_POLL_MS = 3000;

function isActive(analysis: SmurfBoostAnalysisResponse | null): boolean {
  return analysis !== null && ACTIVE_STATUSES.includes(analysis.status);
}

interface SmurfBoostDetectionProps {
  /**
   * Nullable so the card and its search render before a target is chosen; a
   * separate empty-state card would duplicate the approved wording.
   */
  puuid: string | null;
  /**
   * The card is remounted per player, so the page's analyzed player is the
   * result's player by construction.
   */
  playerName: string | null;
  /**
   * The label comes with the control because the page owns its `id`; a
   * `htmlFor` hardcoded here would orphan itself.
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
  playerName,
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

  // Not the player row's `total_matches`: that counts all six synced queues,
  // far more than a ranked-solo-only comparison can read.
  const { data: rankedStats, dataUpdatedAt: rankedStatsReadAt } = useQuery({
    ...playerStatsQueryOptions(puuid ?? ""),
    // No `skipToken` guard here, so a player-less mount would GET
    // `/matches/player//stats` and toast the 404.
    enabled: puuid !== null,
  });

  const completedAt = latest?.completed_at ?? null;
  const runMutation = useMutation({
    mutationFn: async (targetPuuid: string) =>
      unwrap(await startSmurfBoostDetection(targetPuuid)),
    onMutate: async (targetPuuid: string) => {
      setFailure(null);
      // A refetch started before this run must not resolve afterwards and
      // restore the previous analysis over the new one.
      await queryClient.cancelQueries({
        queryKey: smurfBoostQueryKey(targetPuuid),
      });
    },
    // Cache only: options-level callbacks outlive this component's unmount, so
    // anything the viewer sees belongs to the `mutate` call below.
    onSuccess: (data) => {
      // The response is stored under the player it describes, never under
      // whichever player happens to be selected when it arrives.
      queryClient.setQueryData(smurfBoostQueryKey(data.puuid), data);
    },
  });

  // Feedback for the run this card started; react-query skips it once the card
  // is gone, and the cache write above still shows the outcome on return.
  const runComparison = (targetPuuid: string) => {
    runMutation.mutate(targetPuuid, {
      onSuccess: (data) => {
        // Catches a server answering about somebody else; a switched-away card
        // has already stopped firing these.
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
        // The rejection carries the structured ApiError; the sentence is
        // chosen for this surface, so the mutationFn stays presentation-free.
        const message = apiErrorMessage(
          normalizeApiError(mutationError),
          "The comparison could not be run. Please try again.",
        );
        setFailure(message);
        toast.error("Comparison did not run", { description: message });
      },
    });
  };

  // The sync hook adopts any update already in flight, so this marks the fetch
  // as ours. State, not a ref: it also disables the button across the gap.
  const [comparisonOwed, setComparisonOwed] = useState(false);
  // The backend's own words: a sentence of ours would promise a retry that a
  // stale player id or an expired key cannot honour.
  const [staleFetch, setStaleFetch] = useState<string | null>(null);
  // Carries the reading's own timestamp because the count alone cannot say
  // whether it has been re-read since the fetch.
  const [fetchBaseline, setFetchBaseline] = useState<{
    games: number;
    readAt: number;
  } | null>(null);
  // The click fetches from Riot first, so a player the scheduled Match Fetcher
  // has not reached yet is still compared on current history.
  const { isUpdating: isFetchingGames, startSync } = usePlayerSyncRun(
    puuid ?? "",
    {
      // This card already reports the fetch; the hook's wording is written for
      // the Player Card and would contradict it here.
      quiet: true,
      onSettled: (run) => {
        // Before the gate: this card renders the fetch whoever started it, and
        // silence would let the viewer read stored games as fresh.
        setStaleFetch(
          run?.status === "completed"
            ? null
            : (run?.error_message ??
                "This player's newest games could not be fetched."),
        );
        if (run?.status !== "completed") {
          // The hook refreshes caches on a completed run only, so an early
          // stop leaves the stored count below reading from before the click.
          setFetchBaseline(null);
          if (run && puuid) {
            void queryClient.refetchQueries({
              queryKey: playerStatsQueryOptions(puuid).queryKey,
              type: "active",
            });
          }
        }
        if (!comparisonOwed) {
          return;
        }
        setComparisonOwed(false);
        if (puuid) runComparison(puuid);
      },
    },
  );

  if (isLoading) {
    return <RunCardSkeleton />;
  }

  const running = runMutation.isPending || isActive(latest ?? null);
  const results = latest?.status === "completed" ? latest.results : null;
  // A failed run stores no eligible-game total and the column defaults to
  // zero, which would read as a player with no games.
  const shortfallReading =
    latest && latest.status === "completed"
      ? gameShortfall(
          latest.eligible_games,
          latest.thresholds,
          results?.recent_games ?? 0,
        )
      : null;
  // Only when something is actually lacking: quoted at a player whose history
  // clears both windows, a requirements notice reads as a warning.
  const shortfall =
    shortfallReading && shortfallReading.missing > 0
      ? shortfallReading.sentence
      : null;
  const storedRankedGames = rankedStats?.total_matches ?? null;
  // Never gate on `isUpdating`: it goes false a render before the hook
  // refreshes this query, so the line would announce "no new ones" first.
  const fetchedGames =
    fetchBaseline !== null &&
    storedRankedGames !== null &&
    rankedStatsReadAt > fetchBaseline.readAt
      ? storedRankedGames - fetchBaseline.games
      : null;
  const storedFailure =
    latest && latest.status === "failed"
      ? (latest.error_message ??
        "The comparison did not finish. Please try again.")
      : null;

  return (
    <div className="space-y-6">
      {/* The second column is empty on purpose: filling it would mean
          inventing a card nobody asked for. */}
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
              {/* The settings tune the thresholds this run applies, so their
                  trigger lives on the run card. */}
              <div className="ml-auto flex items-center gap-2">
                {latest?.is_stale && (
                  <Badge variant="outline">
                    New games since this comparison
                  </Badge>
                )}
                <SmurfBoostSettingsDialog />
              </div>
            </div>
            <UpdatedStamp
              lastUpdated={completedAt}
              label="Last run"
              className="mt-2 text-sm text-muted-foreground"
            />
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Compare recent games with earlier games, using ranked solo/duo
              games only. Running it fetches this player&apos;s newest games
              from Riot first, so the comparison reads current history rather
              than waiting for the next scheduled update.
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

            {isFetchingGames && (
              <Alert>
                <Download className="h-4 w-4 animate-pulse" />
                <AlertDescription className="space-y-1">
                  <p>
                    Fetching this player&apos;s games from Riot.{" "}
                    {/* An update started elsewhere shows here too, and this
                        card never keeps a comparison promised for it. */}
                    {comparisonOwed
                      ? "The comparison runs on its own as soon as the fetch finishes."
                      : "Run the comparison once it has finished to read the new games."}{" "}
                    How long that takes depends on how many games are missing
                    and on Riot&apos;s rate limit, so there is no honest
                    estimate to show.
                  </p>
                  {shortfall && <p>{shortfall}</p>}
                </AlertDescription>
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

            {staleFetch && !isFetchingGames && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {staleFetch} Only the games already stored are available to
                  compare.
                </AlertDescription>
              </Alert>
            )}

            {/* A label and a number rather than a sentence: zero reads
                correctly here without a plural branch of its own. */}
            {storedRankedGames !== null && (
              <p className="text-sm text-muted-foreground">
                Ranked solo games stored: {storedRankedGames}.
                {fetchedGames !== null &&
                  (fetchedGames > 0
                    ? ` The last fetch added ${fetchedGames}.`
                    : " The last fetch found no new ones.")}
              </p>
            )}

            <Button
              className="button-full"
              onClick={() => {
                if (!puuid) {
                  return;
                }
                setFetchBaseline(
                  storedRankedGames === null
                    ? null
                    : { games: storedRankedGames, readAt: rankedStatsReadAt },
                );
                setComparisonOwed(true);
                startSync();
              }}
              disabled={
                isFetchingGames || comparisonOwed || running || !puuid
              }
            >
              {isFetchingGames || comparisonOwed || running ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {isFetchingGames ? "Fetching games..." : "Comparing games..."}
                </>
              ) : (
                <>
                  <PlayCircle className="mr-2 h-4 w-4" />
                  {results ? "Run the comparison again" : "Run the comparison"}
                </>
              )}
            </Button>

            {/* `Progress` needs a denominator and there is none until the
                fetch ends. Hidden: the button already names the wait. */}
            {(isFetchingGames || comparisonOwed || running) && (
              <div
                aria-hidden="true"
                className="relative h-1 w-full overflow-hidden rounded-full bg-secondary motion-reduce:hidden"
              >
                <div className="absolute inset-y-0 w-1/5 animate-[indeterminate-sweep_1.6s_ease-in-out_infinite] rounded-full bg-primary" />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {results && latest && (
        <SmurfBoostResultCard
          results={results}
          playerName={playerName}
          thresholds={latest.thresholds}
        />
      )}
    </div>
  );
}
