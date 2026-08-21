"use client";

import { CheckCircle, Clock, Loader2, Scale, StopCircle } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

import {
  ANALYSIS_CARD_TRANSITION,
  ANALYSIS_PROGRESS_TRANSITION,
  type UIPhase,
} from "./matchmaking-analysis-state";

interface MatchmakingAnalysisActiveCardProps {
  analyzedPlayerLabel: string;
  phase: UIPhase;
  progressPercentage: number;
  authoritativeProgress: number;
  totalPlayers: number;
  estimatedMinutesRemaining: number | null;
  animProgress: number | null;
  cancelPending: boolean;
  onCancel: () => void;
}

function statusMessage({
  phase,
  animProgress,
  authoritativeProgress,
  totalPlayers,
  estimatedMinutesRemaining,
}: {
  phase: UIPhase;
  animProgress: number | null;
  authoritativeProgress: number;
  totalPlayers: number;
  estimatedMinutesRemaining: number | null;
}): string {
  if (phase === "cancelling") {
    return "Cancelling analysis...";
  }

  const isCompleting =
    phase === "completing-fast" || phase === "completing-slow";
  if (isCompleting) {
    if (animProgress === 0) {
      return "Starting analysis...";
    }
    if (animProgress === 50) {
      return "Fetching matches from the database...";
    }
    return "Analysis finished successfully";
  }

  const minutesLabel = estimatedMinutesRemaining === 1 ? "minute" : "minutes";
  const remainingText = estimatedMinutesRemaining
    ? ` (~${estimatedMinutesRemaining} ${minutesLabel} remaining)`
    : "";
  return `Analyzing ${authoritativeProgress} of ${totalPlayers} players${remainingText}`;
}

export function MatchmakingAnalysisActiveCard({
  analyzedPlayerLabel,
  phase,
  progressPercentage,
  authoritativeProgress,
  totalPlayers,
  estimatedMinutesRemaining,
  animProgress,
  cancelPending,
  onCancel,
}: MatchmakingAnalysisActiveCardProps) {
  const isCompleting =
    phase === "completing-fast" || phase === "completing-slow";
  const showAsFinished = isCompleting && animProgress === 100;

  return (
    <Card className={ANALYSIS_CARD_TRANSITION}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Scale className="h-5 w-5 text-primary" />
            Matchmaking Analysis
          </CardTitle>
          {(phase === "running" || phase === "starting") && (
            <div className="flex items-center gap-2 text-sm font-normal text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>
                {authoritativeProgress} / {totalPlayers} players
              </span>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Running matchmaking analysis for <b>{analyzedPlayerLabel}</b>.
        </p>
        <Alert>
          {showAsFinished ? (
            <CheckCircle className="h-4 w-4 text-green-400" />
          ) : (
            <Loader2 className="h-4 w-4 animate-spin" />
          )}
          <AlertDescription>
            {statusMessage({
              phase,
              animProgress,
              authoritativeProgress,
              totalPlayers,
              estimatedMinutesRemaining,
            })}
          </AlertDescription>
        </Alert>

        <div className="space-y-2">
          <Progress
            value={progressPercentage}
            className={ANALYSIS_PROGRESS_TRANSITION}
          />
          <p className="text-xs text-muted-foreground text-center">
            {Math.round(progressPercentage)}% complete
          </p>
        </div>

        {phase === "running" && (
          <Button
            onClick={onCancel}
            disabled={cancelPending}
            variant="destructive"
            className="w-full red-gradient"
          >
            {cancelPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Cancelling...
              </>
            ) : (
              <>
                <StopCircle className="mr-2 h-4 w-4" />
                Cancel Analysis
              </>
            )}
          </Button>
        )}
        {(phase === "starting" || phase === "cancelling" || isCompleting) && (
          <Button disabled className="w-full gold-gradient button-medium">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {phase === "cancelling" ? "Cancelling..." : "Analyzing..."}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
