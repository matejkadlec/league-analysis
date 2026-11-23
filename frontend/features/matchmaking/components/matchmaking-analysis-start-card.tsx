"use client";

import { useState, type ReactNode } from "react";
import { AlertCircle, Loader2, PlayCircle, Scale } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

import { ANALYSIS_CARD_TRANSITION } from "../matchmaking-analysis-state";
import {
  ANALYSIS_MATCH_COUNT,
  estimateColdRunMinutes,
  formatRunDuration,
} from "../matchmaking-progress";

/** The viewer's calendar date, `YYYY-MM-DD`, from their own clock. */
function localIsoDate(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

interface MatchmakingAnalysisStartCardProps {
  playerSelector: ReactNode;
  analysisFailure: string | null;
  startPending: boolean;
  startLabel: "Start Analysis" | "Run New Analysis";
  endDate: string | null;
  onEndDateChange: (date: string | null) => void;
  onStart: () => void;
}

/**
 * The start card's placeholder, in its geometry -- the description, the two
 * fields, the duration line and the button -- so the result cards below do
 * not move when the latest run answers and the real card replaces it.
 */
export function MatchmakingAnalysisLoadingCard() {
  return (
    <Card aria-busy="true">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Scale className="h-5 w-5 text-primary" />
          Matchmaking Analysis
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="sr-only">Loading analysis...</p>
        <Skeleton className="h-16 w-full" />
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-9 w-full" />
        </div>
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-9 w-40" />
        </div>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </CardContent>
    </Card>
  );
}

export function MatchmakingAnalysisStartCard({
  playerSelector,
  analysisFailure,
  startPending,
  startLabel,
  endDate,
  onEndDateChange,
  onStart,
}: MatchmakingAnalysisStartCardProps) {
  // The viewer's own today (LGA-142): never later than the API's bound (today
  // at UTC+14), so whatever passes here is accepted. Render must stay pure,
  // so the clock is read at mount and again on every change of the field.
  const [today, setToday] = useState(() => localIsoDate(new Date()));
  // ISO dates order as strings. `max` on the input stops the picker but not
  // the keyboard, so a later day is refused here and never sent.
  const endDateInFuture = endDate !== null && endDate > today;

  return (
    <Card className={ANALYSIS_CARD_TRANSITION}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Scale className="h-5 w-5 text-primary" />
          Matchmaking Analysis
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Analyze matchmaking fairness for the analyzed player by comparing
          ally and enemy win rates and ranks across their last{" "}
          {ANALYSIS_MATCH_COUNT} ranked matches. Each participant&apos;s rate
          is measured at the time of the shared match, from the games before
          it. The Calculation Flowchart explains the full model.
        </p>
        {analysisFailure && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{analysisFailure}</AlertDescription>
          </Alert>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="matchmaking-player-search">
            Choose player for analysis
          </Label>
          {playerSelector}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="matchmaking-end-date">
            Last day to include (optional)
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="matchmaking-end-date"
              type="date"
              max={today}
              aria-invalid={endDateInFuture}
              aria-describedby={
                endDateInFuture ? "matchmaking-end-date-error" : undefined
              }
              value={endDate ?? ""}
              onChange={(event) => {
                setToday(localIsoDate(new Date()));
                onEndDateChange(event.target.value || null);
              }}
              className="w-auto"
            />
            {endDate && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onEndDateChange(null)}
              >
                Latest
              </Button>
            )}
          </div>
          {endDateInFuture && (
            <p
              id="matchmaking-end-date-error"
              role="alert"
              className="text-sm text-destructive"
            >
              The last day to include cannot be after today.
            </p>
          )}
        </div>
        <p
          className="text-sm text-muted-foreground"
          data-testid="matchmaking-expected-duration"
        >
          Expected duration: up to about{" "}
          {formatRunDuration(estimateColdRunMinutes(ANALYSIS_MATCH_COUNT))} when
          nothing is stored yet, less for players and matches already fetched.
        </p>
        <Button
          onClick={onStart}
          disabled={startPending || endDateInFuture}
          className="w-full gold-gradient button-medium no-rotation"
        >
          {startPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Starting...
            </>
          ) : (
            <>
              <PlayCircle className="mr-2 h-4 w-4" />
              {startLabel}
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
