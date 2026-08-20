import type { Page } from "@playwright/test";

import { seedAuthenticatedSession } from "./auth";
import { qaUser, trackedPlayer } from "./fixtures";
import { blockUpstreamRequests } from "./offline";

/**
 * The mocked API surface the smurf-and-boost page needs, shared by the
 * behavioural spec and the mobile-layout spec.
 *
 * Both specs drive the same page against the same fixtures, so a fixture that
 * drifts from the real contract fails in both places at once rather than
 * leaving one spec quietly testing a shape the server stopped returning.
 */

export const NOW = "2026-08-14T10:00:00.000Z";
export const PUUID = "smurf-boost-player-puuid";

export const player = trackedPlayer(NOW, {
  puuid: PUUID,
  game_name: "Comparison",
  tag_line: "ONE",
});

export const CONSERVATIVE = {
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

export const SENSITIVE = {
  ...CONSERVATIVE,
  recentWindowSize: 15,
  baselineWindowSize: 30,
  a1StepChangeThreshold: 0.8,
  a2WinRateSurgeThreshold: 0.12,
  a3MinimumNovelGames: 5,
};

export function signal(
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

export function cardPreferences(
  settings: Record<string, number>,
  isDefault: boolean,
) {
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

export function analysis(overrides: Record<string, unknown> = {}) {
  return {
    puuid: PUUID,
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
export async function installSmurfBoostMocks(page: Page): Promise<HarnessState> {
  const state: HarnessState = {
    analyzeCalls: 0,
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
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          current_player: player,
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

    if (path.endsWith("/smurf-boost-detection/analyze")) {
      state.analyzeCalls += 1;
      state.stored = analysis();
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(state.stored),
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

    if (
      path.endsWith("/settings/user/cookie-consent") &&
      request.method() === "PUT"
    ) {
      await route.fulfill({ contentType: "application/json", body: "{}" });
      return;
    }

    await route.fulfill({ status: 404, body: "Not found" });
  });

  return state;
}
