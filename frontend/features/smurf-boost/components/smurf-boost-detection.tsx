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
import { apiErrorMessage } from "@/lib/core/api-error";
import { UpdatedStamp } from "@/features/profile";
import { usePlayerSyncRun } from "@/features/players";
import { useToast } from "@/lib/core/hooks";
import type { SmurfBoostAnalysisResponse } from "@/lib/core/schemas";

import {
  smurfBoostQueryKey,
  smurfBoostQueryOptions,
} from "../smurf-boost-query";
import { gameShortfall } from "../smurf-boost-settings";
import { SmurfBoostResultCard } from "./smurf-boost-result-card";
import { SmurfBoostSettingsDialog } from "./smurf-boost-settings-card";

// The two statuses the backend uses for a run that has not reached a terminal
// state. A run is owned by the account that asked for it, so a start returns
// one of these only when this same account already has one in flight -- a
// second tab, or a double submit -- and attaches to it instead of racing.
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
   * The player being compared, or `null` when none is chosen yet.
   *
   * Nullable so the card -- and the search inside it -- render before there
   * is a target. The alternative was a separate empty-state card, which would
   * have meant a second copy of the approved wording and a second place to
   * forget the search.
   */
  puuid: string | null;
  /**
   * The analyzed player's `Name#Tag`, or `null` while there is none. The
   * analysis response carries only a PUUID, and this card is remounted per
   * player, so the page's analyzed player is the result's player by
   * construction. Shown on the result so a stored reading always says who
   * it describes.
   */
  playerName: string | null;
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

  // A comparison this card still owes for a fetch it asked for itself.
  //
  // The hook adopts whatever update is already in flight for the player --
  // one started from the Player Card, or by another viewer -- so without this
  // the card would compare on the back of somebody else's update and announce
  // a result for a click that never happened.
  //
  // State rather than a ref, because it also has to disable the button: the
  // hook reports the run as finished and only then awaits its cache refresh
  // before calling back, and a click landing in that gap would be answered by
  // the *previous* fetch's callback and its own fetch never compared.
  //
  // It lives only as long as the mount, so a reload mid-fetch drops the
  // pending comparison -- the fetch still lands, and clicking again compares
  // it. Persisting the intent across a reload buys too little for what it
  // would cost.
  const [comparisonOwed, setComparisonOwed] = useState(false);
  // Why a fetch did not finish, in the backend's own reviewed words. Without
  // it the card looks identical to a fully fresh run; with a sentence of our
  // own it would promise a retry that a stale player id or an expired key
  // cannot honour.
  const [staleFetch, setStaleFetch] = useState<string | null>(null);
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
        // whoever started it, having just told the viewer to run the
        // comparison once it finished. Staying silent when that fetch failed
        // would leave them comparing stored games believing otherwise.
        setStaleFetch(
          run?.status === "completed"
            ? null
            : (run?.error_message ??
                "This player's newest games could not be fetched."),
        );
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
  // As of the last run, which is the only count anything has measured: no
  // eligible-game total exists for a player who has never been compared, and
  // the comparison that follows this fetch reports the corrected figure
  // itself. A failed run stores none either -- the column defaults to zero,
  // which would read as a player with no games at all.
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

            <Button
              className="button-full"
              onClick={() => {
                if (!puuid) {
                  return;
                }
                setStaleFetch(null);
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
