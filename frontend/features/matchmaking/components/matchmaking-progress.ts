const RIOT_LONG_WINDOW_SECONDS = 120;
// A representative warm-cache analysis completes about six Riot requests per
// logical player. This drives display-only interpolation; every real backend
// milestone still moves the projection forward immediately.
const ESTIMATED_PLAYERS_PER_WINDOW = 100 / 6;

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

export function estimateMatchmakingMinutesRemaining(
  projectedProgress: number,
  totalPlayers: number,
): number | null {
  const remainingPlayers = Math.max(0, totalPlayers - projectedProgress);
  if (remainingPlayers <= 0) {
    return null;
  }

  const remainingSeconds =
    (remainingPlayers / ESTIMATED_PLAYERS_PER_WINDOW) *
    RIOT_LONG_WINDOW_SECONDS;
  return Math.max(1, Math.ceil(remainingSeconds / 60));
}
