import type { Page } from "@playwright/test";

import { seedAuthenticatedSession } from "./auth";
import { qaUser, trackedPlayer } from "./fixtures";
import { blockUpstreamRequests } from "./offline";

/**
 * The mocked API surface the smurf-and-boost page needs, shared by the
 * behavioural spec and the mobile-layout spec, so a fixture that drifts from
 * the real contract fails in both places at once.
 */

const NOW = "2026-08-14T10:00:00.000Z";
export const PUUID = "smurf-boost-player-puuid";

const player = trackedPlayer(NOW, {
  puuid: PUUID,
  game_name: "Comparison",
  tag_line: "ONE",
});

/**
 * A second player, never tracked and never the account's current one: the
 * page's local search exists to analyse somebody the sidebar has never heard
 * of, so `/players/context` returns only `player`.
 */
export const OTHER_PUUID = "rank-manipulation-other-puuid";

const otherPlayer = trackedPlayer(NOW, {
  puuid: OTHER_PUUID,
  game_name: "Stranger",
  tag_line: "TWO",
  is_tracked: false,
});

const CONSERVATIVE = {
  recentWindowSize: 20,
  baselineWindowSize: 60,
  a1StepChangeThreshold: 1.2,
  a2WinRateSurgeThreshold: 0.2,
  a3NovelChampionThreshold: 1.2,
  a3MinimumNovelGames: 8,
  a4SummonerLevelGate: 45,
  a4PerformanceThreshold: 1.2,
  b1WinRateDeltaThreshold: 0.3,
  b1CompositeFlatCeiling: 0.05,
  b2ConsistencyShiftThreshold: 1.15,
  b3BimodalityThreshold: 0.65,
  b3TailFraction: 0.3,
  b4HighRateFloor: 0.62,
  b4DropThreshold: 0.2,
};

const SENSITIVE = {
  ...CONSERVATIVE,
  recentWindowSize: 15,
  baselineWindowSize: 30,
  a1StepChangeThreshold: 0.8,
  a2WinRateSurgeThreshold: 0.12,
  a3MinimumNovelGames: 5,
};

function signal(
  id: string,
  family: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    family,
    available: true,
    triggered: false,
    sample_size: 20,
    reason: `Measured area ${id}.`,
    notes: [],
    raw_value: 0.4,
    threshold: 1.2,
    saturation: 3,
    magnitude: 0,
    weight: 0.3,
    contribution: 0,
    ...overrides,
  };
}

function cardPreferences(settings: Record<string, number>, isDefault: boolean) {
  return [
    // Top Champions carries a role list, so the shared settings shape is not
    // numeric-only. Getting that wrong rejects the whole catalog.
    {
      cardId: "profile.top-champions",
      version: 1,
      settings: { queueId: 420, displayLimit: 5, includedRoles: [] },
      isDefault: true,
      requiresRecovery: false,
      updatedAt: null,
    },
    {
      cardId: "profile.smurf-boost-detection",
      version: 1,
      settings: { queueId: 420, ...settings },
      isDefault,
      requiresRecovery: false,
      updatedAt: isDefault ? null : NOW,
    },
  ];
}

function analysis(
  puuid: string = PUUID,
  overrides: Record<string, unknown> = {},
) {
  return {
    puuid,
    created_at: NOW,
    status: "completed",
    model_version: "smurf-boost/v1",
    thresholds: { recent_window_size: 20, baseline_window_size: 60 },
    eligible_games: 240,
    latest_match_id: "EUN1_1",
    error_code: null,
    error_message: null,
    completed_at: NOW,
    is_stale: false,
    results: {
      model_version: "smurf-boost/v1",
      confidence: 0.86,
      confidence_band: "high",
      recent_games: 20,
      baseline_games: 60,
      eligible_games: 240,
      notes: ["patch_disjoint_windows"],
      disclaimer:
        "This is a statistical comparison of a player's recent ranked games against their own earlier games. It is not evidence of smurfing, boosting, or account sharing, and it cannot distinguish improvement from any other explanation. Do not use it to accuse anyone.",
      families: [
        {
          family: "rapid_improvement",
          band: "notable_indicators",
          distinct_evidence: 2,
          signals: [
            signal("A1", "rapid_improvement", {
              triggered: true,
              raw_value: 1.45,
            }),
            signal("A2", "rapid_improvement", {
              triggered: true,
              raw_value: 0.28,
              threshold: 0.2,
            }),
            signal("A3", "rapid_improvement", {
              available: false,
              raw_value: null,
              threshold: null,
              saturation: null,
              magnitude: null,
              contribution: null,
              sample_size: 0,
              reason: "No recent game was on a rarely played champion.",
              notes: ["insufficient_novel_sample"],
            }),
            signal("A4", "rapid_improvement"),
          ],
        },
        {
          family: "playing_pattern_change",
          band: "no_unusual_pattern",
          distinct_evidence: 0,
          signals: [
            signal("B1", "playing_pattern_change"),
            signal("B2", "playing_pattern_change"),
          ],
        },
      ],
    },
    ...overrides,
  };
}

export interface HarnessState {
  analyzeCalls: number;
  /** Every PUUID an analyze request asked about, in order. */
  analyzed: string[];
  /** Every PUUID an explicit game fetch was started for, in order. */
  synced: string[];
  /**
   * How many times the run started by the last fetch has been polled. The first
   * three answer `running`, the fourth `completed`: a mock that finished
   * immediately would let a card that never shows the fetch pass.
   */
  syncPolls: number;
  currentPlayer: typeof player | null;
  thresholds: Record<string, number>;
  isDefaultSettings: boolean;
  written: Record<string, unknown> | null;
  stored: Record<string, unknown> | null;
}

/**
 * Routes every API call the page makes. Returns the mutable state the spec
 * asserts on, because a route handler runs in the driver and cannot hand a
 * value back through the page.
 */
export async function installSmurfBoostMocks(
  page: Page,
  // A fresh account has never chosen a player, and `useAnalyzedPlayer` then
  // resolves to none: no `?puuid=`, and nothing to seed one from. Optional so
  // the specs that want the ordinary account do not have to say so.
  { currentPlayer = player }: { currentPlayer?: typeof player | null } = {},
): Promise<HarnessState> {
  const state: HarnessState = {
    analyzeCalls: 0,
    analyzed: [],
    synced: [],
    syncPolls: 0,
    currentPlayer,
    thresholds: CONSERVATIVE,
    isDefaultSettings: true,
    written: null,
    stored: null,
  };

  await seedAuthenticatedSession(page);
  await blockUpstreamRequests(page);
  await page.addInitScript(() => {
    localStorage.setItem("theme", "dark");
  });

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path.endsWith("/auth/me")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(qaUser(NOW)),
      });
      return;
    }

    if (
      path.endsWith("/players/context") ||
      path.endsWith("/players/context/current")
    ) {
      // A write really moves the account's player, so a spec asserting that
      // something left it alone is asserting against a mock that could have
      // shown otherwise.
      if (request.method() === "PUT") {
        const { puuid } = request.postDataJSON() as { puuid: string };
        state.currentPlayer = puuid === OTHER_PUUID ? otherPlayer : player;
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          current_player: state.currentPlayer,
          tracked_players: [player],
        }),
      });
      return;
    }

    if (path.endsWith(`/players/${PUUID}`)) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(player),
      });
      return;
    }

    if (path.endsWith(`/players/${OTHER_PUUID}`)) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(otherPlayer),
      });
      return;
    }

    // The suggestion list behind the shared player search. It answers for the
    // stranger only, so a spec that finds them here has proved the search --
    // not the tracked list -- put them on screen.
    if (path.endsWith("/players/suggestions")) {
      const query = new URL(request.url()).searchParams.get("q") ?? "";
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          "Stranger".toLowerCase().startsWith(query.toLowerCase())
            ? [otherPlayer]
            : [],
        ),
      });
      return;
    }

    if (path.endsWith("/smurf-boost-detection/presets")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          default_preset: "conservative",
          presets: [
            { name: "conservative", thresholds: CONSERVATIVE },
            { name: "sensitive", thresholds: SENSITIVE },
          ],
        }),
      });
      return;
    }

    if (path.endsWith("/settings/card-preferences")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          cardPreferences(state.thresholds, state.isDefaultSettings),
        ),
      });
      return;
    }

    if (
      path.endsWith("/settings/card-preferences/profile.smurf-boost-detection")
    ) {
      if (request.method() === "DELETE") {
        state.thresholds = CONSERVATIVE;
        state.isDefaultSettings = true;
      } else {
        state.written = request.postDataJSON() as Record<string, unknown>;
        state.thresholds = (state.written.settings ?? {}) as Record<
          string,
          number
        >;
        state.isDefaultSettings = false;
      }
      const catalog = cardPreferences(
        state.thresholds,
        state.isDefaultSettings,
      );
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(catalog[1]),
      });
      return;
    }

    // The explicit per-player game fetch the run button starts. The
    // `/players/{puuid}` handlers above match on `endsWith`, so a longer sync
    // path falls through to here regardless of order.
    const syncMatch = /\/players\/([^/]+)\/sync(\/active|\/(\d+))?$/.exec(path);
    if (syncMatch) {
      const target = syncMatch[1]!;
      const run = (status: string) => ({
        id: 7,
        puuid: target,
        status,
        created_at: NOW,
        updated_at: NOW,
        completed_at: status === "completed" ? NOW : null,
      });
      if (syncMatch[2] === "/active") {
        await route.fulfill({ contentType: "application/json", body: "null" });
        return;
      }
      if (syncMatch[3] !== undefined) {
        state.syncPolls += 1;
        await route.fulfill({
          contentType: "application/json",
          // Several polls of slack before the run ends. The assertion that no
          // comparison has started yet is plain and non-retrying, so one poll
          // of room on a starved shared runner would flake.
          body: JSON.stringify(run(state.syncPolls > 3 ? "completed" : "running")),
        });
        return;
      }
      state.synced.push(target);
      state.syncPolls = 0;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(run("pending")),
      });
      return;
    }

    if (path.endsWith("/smurf-boost-detection/analyze")) {
      // Answers about the player the request named. A handler that always
      // said `PUUID` would make a run aimed at anybody else look like it
      // worked while the page silently discarded a mismatched result.
      const target = (request.postDataJSON() as { puuid: string }).puuid;
      state.analyzeCalls += 1;
      state.analyzed.push(target);
      const result = analysis(target);
      if (target === PUUID) state.stored = result;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(result),
      });
      return;
    }

    if (path.endsWith(`/smurf-boost-detection/player/${OTHER_PUUID}`)) {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ detail: "No analysis found for this player" }),
      });
      return;
    }

    if (path.endsWith(`/smurf-boost-detection/player/${PUUID}`)) {
      if (state.stored === null) {
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ detail: "No analysis found for this player" }),
        });
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(state.stored),
      });
      return;
    }

    // The stored ranked-solo pool the run card names above its button. Left
    // unanswered it is one more 404 on the global error toast, sitting beside
    // whatever this suite asserts.
    if (path.includes("/matches/player/") && path.endsWith("/stats")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          puuid: PUUID,
          total_matches: 84,
          wins: 44,
          losses: 40,
          win_rate: 0.524,
          avg_kills: 6.1,
          avg_deaths: 5.2,
          avg_assists: 8.4,
          avg_kda: 2.8,
          avg_cs: 178.5,
          avg_vision_score: 21.3,
        }),
      });
      return;
    }

    // The three remaining `/player-overview` reads the first detection spec loads
    // on its way here. Each is otherwise a 404 raising its own global error
    // toast; `/league` is nullable by design, an unranked player being `null`.
    if (path.endsWith("/league")) {
      await route.fulfill({ contentType: "application/json", body: "null" });
      return;
    }

    if (path.endsWith("/champion-stats")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          puuid: PUUID,
          total_champions: 0,
          champions: [],
        }),
      });
      return;
    }

    if (path.endsWith("/lane-stats")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ puuid: PUUID, total_lanes: 0, lanes: [] }),
      });
      return;
    }

    if (path.endsWith("/settings/user/cookie-consent")) {
      await route.fulfill({ contentType: "application/json", body: "{}" });
      return;
    }

    // Polled every 15s by `serviceStatusQueryOptions`. Unanswered it 404s on
    // that loop, and the global query-error toast it raises then sits beside
    // whatever this suite is asserting.
    if (path.endsWith("/settings/service-status")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          is_under_maintenance: false,
          reason: "ok",
          credential_status: "valid",
          health_revision: 3,
          observed_at: NOW,
          has_recent_recovery: false,
          recovery_notice_key: null,
        }),
      });
      return;
    }

    await route.fulfill({ status: 404, body: "Not found" });
  });

  return state;
}
