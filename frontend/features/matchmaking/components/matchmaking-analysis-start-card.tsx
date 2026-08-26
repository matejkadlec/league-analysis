"use client";

import type { ReactNode } from "react";
import { AlertCircle, Loader2, PlayCircle, Scale } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { ANALYSIS_CARD_TRANSITION } from "./matchmaking-analysis-state";

const MATCH_COUNT_PRESETS = [10, 20, 30] as const;

interface MatchmakingAnalysisStartCardProps {
  playerSelector: ReactNode;
  analysisFailure: string | null;
  startPending: boolean;
  startLabel: "Start Analysis" | "Run New Analysis";
  matchCount: number;
  onMatchCountChange: (count: number) => void;
  endDate: string | null;
  onEndDateChange: (date: string | null) => void;
  onStart: () => void;
}

export function MatchmakingAnalysisLoadingCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Scale className="h-5 w-5 text-primary" />
          Matchmaking Analysis
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">Loading analysis...</p>
      </CardContent>
    </Card>
  );
}

export function MatchmakingAnalysisStartCard({
  playerSelector,
  analysisFailure,
  startPending,
  startLabel,
  matchCount,
  onMatchCountChange,
  endDate,
  onEndDateChange,
  onStart,
}: MatchmakingAnalysisStartCardProps) {
  const today = new Date().toISOString().slice(0, 10);

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
          ally and enemy win rates and ranks across their last {matchCount}{" "}
          ranked matches. Each participant&apos;s rate is measured at the time
          of the shared match. The Calculation Flowchart explains the full
          model.
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
          <Label id="matchmaking-match-count-label">Matches to analyze</Label>
          <div
            className="flex gap-2"
            role="group"
            aria-labelledby="matchmaking-match-count-label"
          >
            {MATCH_COUNT_PRESETS.map((preset) => (
              <Button
                key={preset}
                type="button"
                variant="outline"
                size="sm"
                aria-pressed={matchCount === preset}
                className={
                  matchCount === preset
                    ? "border-primary text-primary"
                    : "text-muted-foreground"
                }
                onClick={() => onMatchCountChange(preset)}
              >
                {preset}
              </Button>
            ))}
          </div>
          {matchCount >= 30 && (
            <p className="text-sm text-muted-foreground">
              Larger runs analyze roughly three times as many players and can
              take much longer on a cold cache.
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="matchmaking-end-date">
            Analyze matches before (optional)
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="matchmaking-end-date"
              type="date"
              max={today}
              value={endDate ?? ""}
              onChange={(event) =>
                onEndDateChange(event.target.value || null)
              }
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
        </div>
        <Button
          onClick={onStart}
          disabled={startPending}
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
