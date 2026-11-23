const RIOT_LONG_WINDOW_SECONDS = 120;
const RIOT_LONG_WINDOW_REQUESTS = 100;
const SAMPLE_MATCHES_PER_PLAYER = 10;

/**
 * Spine matches every new run analyzes: the backend's fixed `MATCH_COUNT`
 * (LGA-140), which refuses any other count.
 */
export const ANALYSIS_MATCH_COUNT = 10;

/**
 * Riot requests of a run of `matchCount` spine matches with nothing cached,
 * per routing host: the backend's `match_v5_max_requests` (regional) and
 * `league_v4_max_requests` (platform). The spine match is in no sample.
 */
export function coldRunRequestsByHost(matchCount: number): {
  matchV5: number;
  leagueV4: number;
} {
  const others = 9 * matchCount;
  return {
    matchV5: 1 + others + matchCount + others * SAMPLE_MATCHES_PER_PLAYER,
    leagueV4: others + 1,
  };
}

/**
 * Minutes that run takes: application limits apply per routing host, so the
 * busier host's requests through its long window set the pace (LGA-147).
 * `docs/matchmaking-analysis.md` carries the same table, and tests read it.
 */
export function estimateColdRunMinutes(matchCount: number): number {
  const { matchV5, leagueV4 } = coldRunRequestsByHost(matchCount);
  return Math.round(
    (Math.max(matchV5, leagueV4) / RIOT_LONG_WINDOW_REQUESTS) *
      (RIOT_LONG_WINDOW_SECONDS / 60),
  );
}

/** "20 min", "1 h", "3 h 20 min". */
export function formatRunDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}
// A warm-cache analysis completes about seven Riot requests per logical player
// (six match reads plus the league-v4 rank read). Display-only interpolation;
// every real backend milestone still moves the projection immediately.
const ESTIMATED_PLAYERS_PER_WINDOW = RIOT_LONG_WINDOW_REQUESTS / 7;

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

// The trailing window the observed pace is measured over. Long enough to
// smooth poll jitter, short enough that a burst of DB-cached players ages
// out quickly instead of promising the cold tail will finish just as fast.
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

  // The recent-window rate is the better predictor when available: cached
  // players finish near-instantly and rate-limit waits slow everything down,
  // and both show up in it — without a warm-up burst haunting the whole run.
  const playersPerSecond =
    observedRate ?? ESTIMATED_PLAYERS_PER_WINDOW / RIOT_LONG_WINDOW_SECONDS;
  return Math.max(1, Math.ceil(remainingPlayers / playersPerSecond / 60));
}
