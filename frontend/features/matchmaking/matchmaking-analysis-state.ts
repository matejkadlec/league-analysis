import type {
  MatchmakingAnalysisResponse,
  MatchmakingAnalysisStatus,
} from "@/lib/core/schemas";

import {
  projectMatchmakingProgress,
  type ProgressProjection,
} from "./matchmaking-progress";

/**
 * Player-slot expectation before the backend's progress keys exist. Reads the
 * run's own params, so it describes what is running, not what the form says.
 */
export function expectedPlayersForRun(
  run: { params: { match_count: number } } | null | undefined,
): number {
  return (run?.params.match_count ?? 10) * 10;
}

export const ANALYSIS_CARD_TRANSITION =
  "transition-colors duration-300 ease-in-out";

export const ANALYSIS_PROGRESS_TRANSITION =
  "h-2 transition-[width,opacity] duration-700 ease-in-out";

export type UIPhase =
  | "idle"
  | "starting"
  | "running"
  | "completing-fast"
  | "completing-slow"
  | "completed"
  | "cancelling";

export interface AnalysisUiState {
  phase: UIPhase;
  animProgress: number | null;
  currentAnalysisCreatedAt: string | null;
  analysisFailure: string | null;
  progressProjection: ProgressProjection;
  sawInProgress: boolean;
  lastBackendProgress: number;
}

export type AnalysisUiAction =
  | { type: "start-requested" }
  | { type: "start-succeeded"; createdAt: string; progress: number }
  | { type: "start-failed"; message: string }
  | { type: "set-anim-progress"; progress: number }
  | { type: "finalize-completed" }
  | { type: "cancel-requested" }
  | { type: "cancel-succeeded" }
  | { type: "cancel-failed" }
  | { type: "observe-active-progress"; progress: number }
  | {
      type: "consider-reanchor";
      analysisCreatedAt: string;
      authoritativeProgress: number;
      totalPlayers: number;
    };

function parseIsoTimestamp(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function isSameAnalysisInstance(
  first: string | null | undefined,
  second: string | null | undefined,
): boolean {
  if (!first || !second) {
    return false;
  }

  if (first === second) {
    return true;
  }

  const firstTimestamp = parseIsoTimestamp(first);
  const secondTimestamp = parseIsoTimestamp(second);
  if (firstTimestamp === null || secondTimestamp === null) {
    return false;
  }

  return firstTimestamp === secondTimestamp;
}

export function analysisFailureMessage(
  analysis: MatchmakingAnalysisResponse | null | undefined,
): string {
  switch (analysis?.error_code) {
    case "RIOT_API_KEY_INVALID":
      return "The Riot API key is invalid or expired. Please contact an administrator.";
    case "riot_service_error":
      return "Riot data could not be loaded for this analysis. Please try again.";
    case "not_enough_matches":
      return (
        analysis.error_message ??
        "This player does not have enough ranked matches for an analysis."
      );
    case "player_not_in_match":
      return "The selected player could not be verified in the latest matches.";
    case "no_matches_analyzed":
      return "No ranked match history could be read for this lobby. Please try again later.";
    case "rate_limit_wait_exhausted":
      return "The analysis could not resume within the allowed Riot rate-limit wait. Please try again later.";
    default:
      return "The analysis did not finish. Please try again.";
  }
}

export function isActiveAnalysisStatus(
  status: MatchmakingAnalysisStatus | undefined,
): boolean {
  return (
    status === "pending" ||
    status === "in_progress" ||
    status === "waiting_rate_limit"
  );
}

function createInitialProjection(
  createdAt: string | null,
  progress: number,
  timestamp = Date.now(),
): ProgressProjection {
  return {
    analysisCreatedAt: createdAt,
    anchorProgress: progress,
    anchorTimestamp: timestamp,
  };
}

function idleState(): AnalysisUiState {
  return {
    phase: "idle",
    animProgress: null,
    currentAnalysisCreatedAt: null,
    analysisFailure: null,
    progressProjection: createInitialProjection(null, 0),
    sawInProgress: false,
    lastBackendProgress: 0,
  };
}

export function initAnalysisUiState(
  latest: MatchmakingAnalysisResponse | null,
): AnalysisUiState {
  const sawActive =
    latest?.status === "in_progress" ||
    latest?.status === "waiting_rate_limit";

  if (latest?.status === "completed") {
    return { ...idleState(), phase: "completed" };
  }

  if (sawActive) {
    return {
      ...idleState(),
      phase: "running",
      currentAnalysisCreatedAt: latest.created_at,
      progressProjection: createInitialProjection(
        latest.created_at,
        latest.progress,
      ),
      sawInProgress: true,
      lastBackendProgress: latest.progress,
    };
  }

  if (latest?.status === "pending") {
    return {
      ...idleState(),
      phase: "starting",
      currentAnalysisCreatedAt: latest.created_at,
      progressProjection: createInitialProjection(
        latest.created_at,
        latest.progress,
      ),
      lastBackendProgress: latest.progress,
    };
  }

  return idleState();
}

function reanchorIfNeeded(
  state: AnalysisUiState,
  action: Extract<AnalysisUiAction, { type: "consider-reanchor" }>,
): AnalysisUiState {
  if (
    !isSameAnalysisInstance(
      state.progressProjection.analysisCreatedAt,
      action.analysisCreatedAt,
    )
  ) {
    return {
      ...state,
      progressProjection: createInitialProjection(
        action.analysisCreatedAt,
        action.authoritativeProgress,
      ),
    };
  }

  const nowTimestamp = Date.now();
  const projectedProgress = projectMatchmakingProgress({
    ...state.progressProjection,
    authoritativeProgress: state.progressProjection.anchorProgress,
    totalPlayers: action.totalPlayers,
    nowTimestamp,
  });
  if (action.authoritativeProgress <= projectedProgress) {
    return state;
  }

  return {
    ...state,
    progressProjection: createInitialProjection(
      action.analysisCreatedAt,
      action.authoritativeProgress,
      nowTimestamp,
    ),
  };
}

export function analysisUiReducer(
  state: AnalysisUiState,
  action: AnalysisUiAction,
): AnalysisUiState {
  switch (action.type) {
    case "start-requested":
      return {
        ...idleState(),
        phase: "starting",
      };
    case "start-succeeded":
      return {
        ...state,
        phase: "running",
        currentAnalysisCreatedAt: action.createdAt,
        progressProjection: createInitialProjection(
          action.createdAt,
          action.progress,
        ),
      };
    case "start-failed":
      return {
        ...state,
        phase: "idle",
        analysisFailure: action.message,
      };
    case "set-anim-progress":
      return { ...state, animProgress: action.progress };
    case "finalize-completed":
      return {
        ...state,
        phase: "completed",
        currentAnalysisCreatedAt: null,
        animProgress: null,
      };
    case "cancel-requested":
      return { ...state, phase: "cancelling" };
    case "cancel-succeeded":
      return idleState();
    case "cancel-failed":
      return { ...state, phase: "running" };
    case "observe-active-progress":
      return {
        ...state,
        sawInProgress: true,
        lastBackendProgress: action.progress,
      };
    case "consider-reanchor":
      return reanchorIfNeeded(state, action);
  }
}

export function resolveDisplayPhase(
  phase: UIPhase,
  backendStatus: MatchmakingAnalysisStatus | undefined,
  idleLatestStatus: MatchmakingAnalysisStatus | undefined,
  hasSessionFailure: boolean,
  isFastCompletion: boolean,
): UIPhase {
  if (
    phase === "cancelling" ||
    phase === "completing-fast" ||
    phase === "completing-slow" ||
    phase === "completed"
  ) {
    return phase;
  }

  if (phase === "starting" || phase === "running") {
    if (backendStatus === "completed") {
      return isFastCompletion ? "completing-fast" : "completing-slow";
    }
    if (backendStatus === "failed" || backendStatus === "cancelled") {
      return "idle";
    }
    if (
      phase === "starting" &&
      (backendStatus === "in_progress" ||
        backendStatus === "waiting_rate_limit")
    ) {
      return "running";
    }
    return phase;
  }

  if (hasSessionFailure) {
    return "idle";
  }
  if (idleLatestStatus === "completed") {
    return "completed";
  }
  if (
    idleLatestStatus === "in_progress" ||
    idleLatestStatus === "waiting_rate_limit"
  ) {
    return "running";
  }
  if (idleLatestStatus === "pending") {
    return "starting";
  }
  return "idle";
}

export function resolveWatchingCreatedAt(
  state: AnalysisUiState,
  latest: MatchmakingAnalysisResponse | null,
): string | null {
  if (state.currentAnalysisCreatedAt) {
    return state.currentAnalysisCreatedAt;
  }
  if (state.phase === "idle" && latest && isActiveAnalysisStatus(latest.status)) {
    return latest.created_at;
  }
  return null;
}

export function resolveDisplayedAnimProgress(
  phase: UIPhase,
  animProgress: number | null,
): number | null {
  if (animProgress !== null) {
    return animProgress;
  }
  if (phase === "completing-fast") {
    return 0;
  }
  if (phase === "completing-slow") {
    return 100;
  }
  return null;
}

export function resolveDisplayedFailure(
  displayPhase: UIPhase,
  storedPhase: UIPhase,
  backendStatus: MatchmakingAnalysisStatus | undefined,
  storedFailure: string | null,
  terminalAnalysis: MatchmakingAnalysisResponse | null | undefined,
): string | null {
  if (
    displayPhase === "idle" &&
    (storedPhase === "running" || storedPhase === "starting") &&
    backendStatus === "failed"
  ) {
    return analysisFailureMessage(terminalAnalysis);
  }
  return storedFailure;
}
