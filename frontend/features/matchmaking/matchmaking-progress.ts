const RIOT_LONG_WINDOW_SECONDS = 120;
// ~7 Riot requests per player on a warm cache (six match reads plus league-v4).
// Display-only: every real backend milestone still moves the projection.
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

export interface ThroughputSample {
  timestamp: number;
  progress: number;
}

// Long enough to smooth poll jitter, short enough that a burst of DB-cached
// players ages out instead of promising the cold tail will finish as fast.
const THROUGHPUT_WINDOW_MS = 60_000;
const MIN_THROUGHPUT_SPAN_MS = 15_000;

export function appendThroughputSample(
  samples: ThroughputSample[],
  timestamp: number,
  progress: number,
): ThroughputSample[] {
  const last = samples[samples.length - 1];
  // A progress drop means a different run took over; its history is noise.
  const kept = last && progress < last.progress ? [] : samples;
  return [...kept, { timestamp, progress }].filter(
    (sample) => timestamp - sample.timestamp <= THROUGHPUT_WINDOW_MS,
  );
}

/**
 * Players per second over the trailing window, or null while the window is
 * too short or shows no progress (fresh run, or a rate-limit stall).
 */
export function observedPlayersPerSecond(
  samples: ThroughputSample[],
): number | null {
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last) {
    return null;
  }
  const spanMs = last.timestamp - first.timestamp;
  const completed = last.progress - first.progress;
  if (spanMs < MIN_THROUGHPUT_SPAN_MS || completed <= 0) {
    return null;
  }
  return completed / (spanMs / 1000);
}

export function estimateMatchmakingMinutesRemaining(
  projectedProgress: number,
  totalPlayers: number,
  observedRate?: number | null,
): number | null {
  const remainingPlayers = Math.max(0, totalPlayers - projectedProgress);
  if (remainingPlayers <= 0) {
    return null;
  }

  // The recent window is the better predictor: cached players and rate-limit
  // waits both show up in it, without a warm-up burst haunting the whole run.
  const playersPerSecond =
    observedRate ?? ESTIMATED_PLAYERS_PER_WINDOW / RIOT_LONG_WINDOW_SECONDS;
  return Math.max(1, Math.ceil(remainingPlayers / playersPerSecond / 60));
}
