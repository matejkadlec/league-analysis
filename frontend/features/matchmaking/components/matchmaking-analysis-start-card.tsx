"use client";

import type { ReactNode } from "react";
import { AlertCircle, Loader2, PlayCircle, Scale } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

import { ANALYSIS_CARD_TRANSITION } from "./matchmaking-analysis-state";

interface MatchmakingAnalysisStartCardProps {
  playerSelector: ReactNode;
  analysisFailure: string | null;
  startPending: boolean;
  startLabel: "Start Analysis" | "Run New Analysis";
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
  onStart,
}: MatchmakingAnalysisStartCardProps) {
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
          ally and enemy win rates across their last 10 ranked matches. Each
          participant&apos;s rate is measured at the time of the shared match.
          The Calculation Flowchart explains the full model.
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
