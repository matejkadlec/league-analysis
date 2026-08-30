import { describe, expect, it } from "vitest";

import {
  analysisUiReducer,
  expectedPlayersForRun,
  initAnalysisUiState,
  isActiveAnalysisStatus,
  isSameAnalysisInstance,
  resolveDisplayPhase,
  resolveDisplayedAnimProgress,
  resolveDisplayedFailure,
  resolveWatchingCreatedAt,
  type AnalysisUiState,
} from "@/features/matchmaking/matchmaking-analysis-state";
import {
  MatchmakingAnalysisResponseSchema,
  type MatchmakingAnalysisResponse,
  type MatchmakingAnalysisStatus,
} from "@/lib/core/schemas";

const createdAt = "2026-08-09T01:00:00.000Z";

// A run stored as complete but carrying no results is rewritten to `failed`
// by the schema, so "completed" needs a real payload to stay completed.
const RESULTS = {
  team_avg_winrate: 0.5,
  enemy_avg_winrate: 0.5,
  matches_analyzed: 10,
};

// Parsed through the real schema so a fixture the API could never send fails
// here rather than agreeing with a hand-written shape.
function analysis(
  status: MatchmakingAnalysisStatus,
  overrides: Record<string, unknown> = {},
): MatchmakingAnalysisResponse {
  return MatchmakingAnalysisResponseSchema.parse({
    puuid: "player-puuid",
    status,
    progress: 0,
    total_puuids: 100,
    results: null,
    created_at: createdAt,
    started_at: status === "pending" ? null : createdAt,
    completed_at: null,
    error_code: null,
    error_message: null,
    requests_saved: 0,
    rate_limit_reset_at: null,
    params: { match_count: 10, end_date: null },
    ...overrides,
  });
}

describe("isSameAnalysisInstance", () => {
  it("treats two missing ids as different runs, not as one", () => {
    // The reducer re-anchors progress whenever this says "different". Calling
    // two absences equal makes a fresh run inherit the previous run's anchor
    // and display a progress bar that starts wherever the last one stopped.
    expect(isSameAnalysisInstance(null, null)).toBe(false);
    expect(isSameAnalysisInstance(undefined, createdAt)).toBe(false);
    expect(isSameAnalysisInstance(createdAt, "")).toBe(false);
  });

  it("matches the same instant written two ways", () => {
    // The backend and the cache disagree on trailing zeros and on `Z` versus
    // `+00:00`; comparing the strings alone would re-anchor on every poll.
    expect(
      isSameAnalysisInstance("2026-08-09T01:00:00.000Z", "2026-08-09T01:00:00Z"),
    ).toBe(true);
    expect(
      isSameAnalysisInstance(
        "2026-08-09T01:00:00.000Z",
        "2026-08-09T03:00:00.000+02:00",
      ),
    ).toBe(true);
  });

  it("separates different instants and unreadable ids", () => {
    expect(
      isSameAnalysisInstance(createdAt, "2026-08-09T01:00:01.000Z"),
    ).toBe(false);
    expect(isSameAnalysisInstance("not-a-date", "also-not-a-date")).toBe(false);
  });
});

describe("expectedPlayersForRun", () => {
  it("counts ten players per requested match, and assumes ten matches", () => {
    expect(expectedPlayersForRun({ params: { match_count: 25 } })).toBe(250);
    expect(expectedPlayersForRun(null)).toBe(100);
  });
});

describe("isActiveAnalysisStatus", () => {
  it("counts a rate-limit wait as still running", () => {
    // A run parked on Riot's rate limit is the longest-lived active state
    // here. Reading it as finished stops the watch on a run still going.
    expect(isActiveAnalysisStatus("waiting_rate_limit")).toBe(true);
    expect(isActiveAnalysisStatus("pending")).toBe(true);
    expect(isActiveAnalysisStatus("in_progress")).toBe(true);
  });

  it("counts every terminal status as finished", () => {
    expect(isActiveAnalysisStatus("completed")).toBe(false);
    expect(isActiveAnalysisStatus("failed")).toBe(false);
    expect(isActiveAnalysisStatus("cancelled")).toBe(false);
    expect(isActiveAnalysisStatus(undefined)).toBe(false);
  });
});

describe("initAnalysisUiState", () => {
  it("adopts a run still going, with its progress as the anchor", () => {
    const state = initAnalysisUiState(analysis("in_progress", { progress: 40 }));

    expect(state.phase).toBe("running");
    expect(state.currentAnalysisCreatedAt).toBe(createdAt);
    expect(state.lastBackendProgress).toBe(40);
    expect(state.progressProjection.anchorProgress).toBe(40);
    // Set on arrival, not on the first poll: a reload mid-run must not look
    // like a run that has never reported progress.
    expect(state.sawInProgress).toBe(true);
  });

  it("shows a pending run as starting and a finished one as completed", () => {
    const finished = analysis("completed", {
      results: RESULTS,
      completed_at: createdAt,
    });

    expect(initAnalysisUiState(analysis("pending")).phase).toBe("starting");
    expect(initAnalysisUiState(finished).phase).toBe("completed");
    // A finished run is not watched, so it carries no id to poll for.
    expect(initAnalysisUiState(finished).currentAnalysisCreatedAt).toBeNull();
  });

  it("falls back to idle for a failed, cancelled or absent run", () => {
    expect(initAnalysisUiState(analysis("failed")).phase).toBe("idle");
    expect(initAnalysisUiState(analysis("cancelled")).phase).toBe("idle");
    expect(initAnalysisUiState(null).phase).toBe("idle");
  });
});

describe("analysisUiReducer", () => {
  const idle = initAnalysisUiState(null);

  function running(): AnalysisUiState {
    return analysisUiReducer(
      analysisUiReducer(idle, { type: "start-requested" }),
      { type: "start-succeeded", createdAt, progress: 20 },
    );
  }

  it("drops the previous run entirely when a new start is asked for", () => {
    const failed = analysisUiReducer(running(), {
      type: "start-failed",
      message: "It broke.",
    });

    const restarted = analysisUiReducer(failed, { type: "start-requested" });

    // The failure message and the old run's anchor both belong to the run
    // being replaced; carrying either shows the last run's error over the new
    // run's progress bar.
    expect(restarted.phase).toBe("starting");
    expect(restarted.analysisFailure).toBeNull();
    expect(restarted.currentAnalysisCreatedAt).toBeNull();
    expect(restarted.progressProjection.anchorProgress).toBe(0);
  });

  it("keeps the failure it was given when a start is refused", () => {
    const failed = analysisUiReducer(running(), {
      type: "start-failed",
      message: "It broke.",
    });

    expect(failed.phase).toBe("idle");
    expect(failed.analysisFailure).toBe("It broke.");
  });

  it("stops watching once a run is finalized", () => {
    const done = analysisUiReducer(running(), { type: "finalize-completed" });

    expect(done.phase).toBe("completed");
    expect(done.currentAnalysisCreatedAt).toBeNull();
    expect(done.animProgress).toBeNull();
  });

  it("returns to running when a cancel is refused, and to idle when it lands", () => {
    const cancelling = analysisUiReducer(running(), {
      type: "cancel-requested",
    });
    expect(cancelling.phase).toBe("cancelling");

    expect(analysisUiReducer(cancelling, { type: "cancel-failed" }).phase).toBe(
      "running",
    );
    const cancelled = analysisUiReducer(cancelling, {
      type: "cancel-succeeded",
    });
    expect(cancelled.phase).toBe("idle");
    expect(cancelled.currentAnalysisCreatedAt).toBeNull();
  });

  it("records that the backend reported progress at least once", () => {
    const observed = analysisUiReducer(idle, {
      type: "observe-active-progress",
      progress: 15,
    });

    expect(observed.sawInProgress).toBe(true);
    expect(observed.lastBackendProgress).toBe(15);
  });

  it("re-anchors progress when the run being reported is a different one", () => {
    const other = "2026-08-09T05:00:00.000Z";

    const reanchored = analysisUiReducer(running(), {
      type: "consider-reanchor",
      analysisCreatedAt: other,
      authoritativeProgress: 3,
      totalPlayers: 100,
    });

    expect(reanchored.progressProjection.analysisCreatedAt).toBe(other);
    expect(reanchored.progressProjection.anchorProgress).toBe(3);
  });

  it("never rewinds the bar to a figure the projection has already passed", () => {
    // The projected bar runs ahead of the backend on purpose. Re-anchoring to
    // a number it has already shown would make the bar jump backwards.
    const state = running();

    const behind = analysisUiReducer(state, {
      type: "consider-reanchor",
      analysisCreatedAt: createdAt,
      authoritativeProgress: 20,
      totalPlayers: 100,
    });

    expect(behind.progressProjection).toBe(state.progressProjection);
  });

  it("re-anchors when the backend has genuinely overtaken the projection", () => {
    const ahead = analysisUiReducer(running(), {
      type: "consider-reanchor",
      analysisCreatedAt: createdAt,
      authoritativeProgress: 95,
      totalPlayers: 100,
    });

    expect(ahead.progressProjection.anchorProgress).toBe(95);
  });
});

describe("resolveDisplayPhase", () => {
  it("lets the closing animations finish rather than re-deriving them", () => {
    // These four are driven by timers, not by the backend, so a status
    // arriving mid-animation must not cut it short.
    for (const phase of [
      "cancelling",
      "completing-fast",
      "completing-slow",
      "completed",
    ] as const) {
      expect(resolveDisplayPhase(phase, "in_progress", undefined, false, false)).toBe(
        phase,
      );
    }
  });

  it("picks the completion animation the run's length calls for", () => {
    expect(resolveDisplayPhase("running", "completed", undefined, false, true)).toBe(
      "completing-fast",
    );
    expect(resolveDisplayPhase("running", "completed", undefined, false, false)).toBe(
      "completing-slow",
    );
  });

  it("drops a started run back to idle when the backend ends it badly", () => {
    expect(resolveDisplayPhase("running", "failed", undefined, false, false)).toBe(
      "idle",
    );
    expect(resolveDisplayPhase("starting", "cancelled", undefined, false, false)).toBe(
      "idle",
    );
  });

  it("promotes starting to running only once the backend confirms it", () => {
    expect(
      resolveDisplayPhase("starting", "in_progress", undefined, false, false),
    ).toBe("running");
    expect(
      resolveDisplayPhase("starting", "waiting_rate_limit", undefined, false, false),
    ).toBe("running");
    expect(resolveDisplayPhase("starting", "pending", undefined, false, false)).toBe(
      "starting",
    );
  });

  it("prefers a session failure over whatever the stored run says", () => {
    // The failure belongs to the attempt just made; the stored run is the one
    // before it. Showing the older run's completion hides the error.
    expect(resolveDisplayPhase("idle", undefined, "completed", true, false)).toBe(
      "idle",
    );
    expect(resolveDisplayPhase("idle", undefined, "completed", false, false)).toBe(
      "completed",
    );
  });

  it("adopts an idle session to whatever the stored run was doing", () => {
    expect(resolveDisplayPhase("idle", undefined, "in_progress", false, false)).toBe(
      "running",
    );
    expect(
      resolveDisplayPhase("idle", undefined, "waiting_rate_limit", false, false),
    ).toBe("running");
    expect(resolveDisplayPhase("idle", undefined, "pending", false, false)).toBe(
      "starting",
    );
    expect(resolveDisplayPhase("idle", undefined, "failed", false, false)).toBe(
      "idle",
    );
  });
});

describe("resolveWatchingCreatedAt", () => {
  it("watches the session's own run before anything handed down", () => {
    const state = analysisUiReducer(initAnalysisUiState(null), {
      type: "start-succeeded",
      createdAt,
      progress: 0,
    });

    expect(
      resolveWatchingCreatedAt(state, analysis("in_progress", {
        created_at: "2026-08-09T09:00:00.000Z",
      })),
    ).toBe(createdAt);
  });

  it("adopts a still-running stored run while the session is idle", () => {
    const idle = initAnalysisUiState(null);

    expect(resolveWatchingCreatedAt(idle, analysis("in_progress"))).toBe(
      createdAt,
    );
    expect(
      resolveWatchingCreatedAt(
        idle,
        analysis("completed", { results: RESULTS, completed_at: createdAt }),
      ),
    ).toBeNull();
    expect(resolveWatchingCreatedAt(idle, null)).toBeNull();
  });
});

describe("resolveDisplayedAnimProgress", () => {
  it("ends a fast completion at the bottom and a slow one at the top", () => {
    // The two animations differ only in where the bar is left, so a shared
    // value here would make a fast completion look like a slow one.
    expect(resolveDisplayedAnimProgress("completing-fast", null)).toBe(0);
    expect(resolveDisplayedAnimProgress("completing-slow", null)).toBe(100);
    expect(resolveDisplayedAnimProgress("running", null)).toBeNull();
  });

  it("keeps a value the animation has already set", () => {
    expect(resolveDisplayedAnimProgress("completing-slow", 42)).toBe(42);
  });
});

describe("resolveDisplayedFailure", () => {
  it("explains a run the backend failed while the session was watching it", () => {
    const message = resolveDisplayedFailure(
      "idle",
      "running",
      "failed",
      null,
      analysis("failed", { error_code: "no_matches_analyzed" }),
    );

    expect(message).toContain("No ranked match history");
  });

  it("keeps the session's own failure everywhere else", () => {
    expect(
      resolveDisplayedFailure("idle", "idle", "failed", "Stored.", null),
    ).toBe("Stored.");
    expect(
      resolveDisplayedFailure("running", "running", "failed", "Stored.", null),
    ).toBe("Stored.");
    expect(
      resolveDisplayedFailure("idle", "running", "completed", "Stored.", null),
    ).toBe("Stored.");
  });
});
