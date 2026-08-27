const RIOT_LONG_WINDOW_SECONDS = 120;
// A warm-cache analysis completes about seven Riot requests per logical player
// (six match reads plus the league-v4 rank read). Display-only interpolation;
// every real backend milestone still moves the projection immediately.
const ESTIMATED_PLAYERS_PER_WINDOW = 100 / 7;

export interface ProgressProjection {
  analysisCreatedAt: string | null;
  anchorProgress: number;
  anchorTimestamp: number;
}

interface ProjectProgressInput extends ProgressProjection {
  authoritativeProgress: number;
  totalPlayers: number;
  nowTimestamp: number;
}

export function projectMatchmakingProgress({
  authoritativeProgress,
  totalPlayers,
  analysisCreatedAt,
  anchorProgress,
  anchorTimestamp,
  nowTimestamp,
}: ProjectProgressInput): number {
  if (!analysisCreatedAt || totalPlayers <= 0) {
    return Math.max(authoritativeProgress, 0);
  }

  const elapsedSeconds = Math.max(0, nowTimestamp - anchorTimestamp) / 1000;
  const projectedProgress =
    anchorProgress +
    (elapsedSeconds * ESTIMATED_PLAYERS_PER_WINDOW) / RIOT_LONG_WINDOW_SECONDS;
  const activeRunCap = totalPlayers * 0.99;

  return Math.min(
    Math.max(authoritativeProgress, projectedProgress),
    activeRunCap,
  );
}

// Below this many completed players the observed rate is too noisy to trust,
// so the static warm-cache estimate holds until the run has shown its pace.
const MIN_OBSERVED_PLAYERS = 10;

export function estimateMatchmakingMinutesRemaining(
  projectedProgress: number,
  totalPlayers: number,
  startedAt?: string | null,
  nowTimestamp = Date.now(),
): number | null {
  const remainingPlayers = Math.max(0, totalPlayers - projectedProgress);
  if (remainingPlayers <= 0) {
    return null;
  }

  let remainingSeconds =
    (remainingPlayers / ESTIMATED_PLAYERS_PER_WINDOW) *
    RIOT_LONG_WINDOW_SECONDS;

  // Once enough players finished, the run's own throughput is the better
  // predictor: DB-cached players complete near-instantly and rate-limit
  // waits slow everything down, and both show up in the observed rate.
  const startedTimestamp = startedAt ? new Date(startedAt).getTime() : NaN;
  const elapsedSeconds = (nowTimestamp - startedTimestamp) / 1000;
  if (
    Number.isFinite(elapsedSeconds) &&
    elapsedSeconds > 0 &&
    projectedProgress >= MIN_OBSERVED_PLAYERS
  ) {
    remainingSeconds = remainingPlayers / (projectedProgress / elapsedSeconds);
  }

  return Math.max(1, Math.ceil(remainingSeconds / 60));
}
