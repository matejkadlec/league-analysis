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
import { unwrap } from "@/lib/core/api";
import { apiErrorMessage, normalizeApiError } from "@/lib/core/api-error";
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
import { SmurfBoostSettingsDialog } from "./smurf-boost-settings-card";

// The two statuses for a run that has not reached a terminal state. A run is
// owned by the account that asked for it, so a start returns one of these only
// when this account already has one in flight, and attaches to it.
const ACTIVE_STATUSES = ["pending", "in_progress"];

// How often an active run is re-read. The computation finishes inside its own
// request, so an active row seen here belongs to this account's other in-flight
// request and resolves within seconds.
const ACTIVE_POLL_MS = 3000;

function isActive(analysis: SmurfBoostAnalysisResponse | null): boolean {
  return analysis !== null && ACTIVE_STATUSES.includes(analysis.status);
}

interface SmurfBoostDetectionProps {
  /**
   * The player being compared, or `null` when none is chosen yet. Nullable so
   * the card -- and the search inside it -- render before there is a target;
   * a separate empty-state card meant a second copy of the approved wording.
   */
  puuid: string | null;
  /**
   * The analyzed player's `Name#Tag`, or `null` while there is none. This
   * card is remounted per player, so the page's analyzed player is the
   * result's player by construction, and a stored reading says who it is for.
   */
  playerName: string | null;
  /**
   * The page's local player search, label and all, rendered inside this card.
   * The label comes with it because the page owns the control's `id`, and a
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

  // The pool the comparison draws from, and the only count that exists before
  // a first run. Not the player row's `total_matches`: that counts all six
  // synced queues, far more than a ranked-solo-only comparison can read.
  const { data: rankedStats, dataUpdatedAt: rankedStatsReadAt } = useQuery({
    ...playerStatsQueryOptions(puuid ?? ""),
    // Required, not decorative: unlike `playerQueryOptions` this one has no
    // `skipToken` guard, and `/matches/player//stats` is a 404 the global
    // query-error toast would report on every player-less mount.
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
    // Cache only. Anything the viewer sees belongs to the `mutate` call below:
    // these options-level callbacks live on the mutation, so they still run
    // after this component unmounts, against a stale closure's player.
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
        // Compared against the player this run asked about, not the card's
        // current one: these callbacks stop firing once the card is gone, so
        // what is left to catch is a server answering about somebody else.
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
        // Presentation lives here, not in the mutationFn: the rejection
        // carries the structured ApiError, and the sentence is chosen only
        // for this surface.
        const message = apiErrorMessage(
          normalizeApiError(mutationError),
          "The comparison could not be run. Please try again.",
        );
        setFailure(message);
        toast.error("Comparison did not run", { description: message });
      },
    });
  };

  // A comparison this card still owes for a fetch it asked for itself: the
  // sync hook adopts whatever update is already in flight. State, not a ref,
  // because it also disables the button across the callback gap.
  const [comparisonOwed, setComparisonOwed] = useState(false);
  // Why a fetch did not finish, in the backend's own reviewed words: a
  // sentence of our own would promise a retry that a stale player id or an
  // expired key cannot honour.
  const [staleFetch, setStaleFetch] = useState<string | null>(null);
  // Stored ranked games as they stood when this card asked for a fetch, so the
  // line below can say what the fetch added. With the reading's own timestamp,
  // because the count alone cannot say whether it has been re-read since.
  const [fetchBaseline, setFetchBaseline] = useState<{
    games: number;
    readAt: number;
  } | null>(null);
  // The click fetches this player's games from Riot before comparing them, so
  // a player the scheduled Match Fetcher has not reached yet is compared on
  // what Riot holds now instead of on whatever happened to be stored.
  const { isUpdating: isFetchingGames, startSync } = usePlayerSyncRun(
    puuid ?? "",
    {
      // Everything about the fetch is on this card already -- the button, the
      // alert below it, and the stale-fetch notice. The hook's own wording is
      // written for the Player Card and would contradict it here.
      quiet: true,
      onSettled: (run) => {
        // Reported before the gate, not after it: this card renders the fetch
        // whoever started it. Staying silent when a fetch failed would leave
        // the viewer comparing stored games believing they are fresh.
        setStaleFetch(
          run?.status === "completed"
            ? null
            : (run?.error_message ??
                "This player's newest games could not be fetched."),
        );
        if (run?.status !== "completed") {
          // The hook refreshes this player's caches on a completed run only,
          // so a run that stopped early leaves the stored count below reading
          // the number from before the click, minus whatever it did store.
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
  // As of the last run, the only count anything has measured: no eligible-game
  // total exists for a player never compared. A failed run stores none, and the
  // column defaults to zero, which reads as a player with no games.
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
  // Only against a count re-read since the click, never against `isUpdating`:
  // that goes false a render and a round trip before the hook refreshes this
  // query, so a fetch that added games would announce "no new ones" first.
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
              {/* The settings tune the thresholds this run applies, so their
                  trigger lives on the run card rather than floating on the
                  page. */}
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
                    {/* An update started elsewhere -- the Player Card's own
                        button -- shows here too, and promising a comparison
                        for it would be a promise this card never keeps. */}
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

            {/* What there is to compare, before anything has been compared.
                A label and a number rather than a sentence: zero reads
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

            {/* Motion for a wait nothing can measure: `Progress` needs a
                denominator and there is none until the fetch ends. Hidden
                from assistive tech because the button already names it. */}
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
