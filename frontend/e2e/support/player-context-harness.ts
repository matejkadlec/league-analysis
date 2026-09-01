import type { Page } from "@playwright/test";

import { seedAuthenticatedSession } from "./auth";
import { qaUser, trackedPlayer } from "./fixtures";
import { blockUpstreamRequests } from "./offline";

/**
 * Six tracked players, one untracked, one who exists only as a suggestion:
 * enough rows that the dialog's list scrolls, which the assertions need.
 */

const NOW = "2026-08-09T10:00:00.000Z";

export const CURRENT_PUUID = "current-player-puuid";
export const RECENT_PUUID = "recent-player-puuid";
export const ANALYZED_PUUID = "analyzed-player-puuid";
const THIRD_PUUID = "third-player-puuid";
const FOURTH_PUUID = "fourth-player-puuid";
const FIFTH_PUUID = "fifth-player-puuid";
const SIXTH_PUUID = "sixth-player-puuid";

const player = (
  puuid: string,
  game_name: string,
  tag_line: string,
  platform = "eun1",
) => trackedPlayer(NOW, { puuid, game_name, tag_line, platform });

const players = {
  [CURRENT_PUUID]: player(CURRENT_PUUID, "Current", "ONE"),
  // The one untracked player, which the toggle's "Untracked" state is asserted
  // against; the button reads `is_tracked` off the player row itself.
  [RECENT_PUUID]: {
    ...player(RECENT_PUUID, "Recent", "TWO", "euw1"),
    is_tracked: false,
  },
  [THIRD_PUUID]: player(THIRD_PUUID, "Third", "THR"),
  [FOURTH_PUUID]: player(FOURTH_PUUID, "Fourth", "FOR"),
  [FIFTH_PUUID]: player(FIFTH_PUUID, "Fifth", "FIV"),
  [SIXTH_PUUID]: player(SIXTH_PUUID, "Sixth", "SIX"),
};

const analyzedPlayer = {
  ...players[CURRENT_PUUID],
  puuid: ANALYZED_PUUID,
  game_name: "Analyzed",
  tag_line: "LOCAL",
  platform: "euw1",
  is_tracked: false,
};

export interface PlayerContextState {
  /** The account's player, as the last write to `/players/context/current` left it. */
  currentPuuid: string;
  /** How many times that write has been made. */
  currentPlayerUpdates: number;
  /** How many match syncs have been started. */
  syncStarts: number;
}

/**
 * Routes every API call these pages make; returns mutable state because a
 * route handler cannot hand one back. Specs enter via `startAtPlayerOverview`.
 */
async function installPlayerContextMocks(
  page: Page,
  { currentPuuid = CURRENT_PUUID }: { currentPuuid?: string } = {},
): Promise<PlayerContextState> {
  const state: PlayerContextState = {
    currentPuuid,
    currentPlayerUpdates: 0,
    syncStarts: 0,
  };

  await seedAuthenticatedSession(page);
  await blockUpstreamRequests(page);
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
      if (path.endsWith("/players/context/current")) {
        const body = request.postDataJSON() as { puuid: string };
        state.currentPuuid = body.puuid;
        state.currentPlayerUpdates += 1;
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          current_player: players[state.currentPuuid as keyof typeof players],
          tracked_players: Object.values(players),
        }),
      });
      return;
    }

    if (path.endsWith("/players/tracked/list")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(Object.values(players)),
      });
      return;
    }

    if (path.endsWith("/players/suggestions")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify([analyzedPlayer]),
      });
      return;
    }

    if (path.includes(`/matchmaking-analysis/player/${ANALYZED_PUUID}`)) {
      if (path.endsWith("/history")) {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ items: [] }),
        });
      } else {
        await route.fulfill({ status: 404, body: "Not found" });
      }
      return;
    }

    if (path.endsWith("/league")) {
      await route.fulfill({
        contentType: "application/json",
        body: "null",
      });
      return;
    }

    const statsPlayer = Object.values(players).find((candidate) =>
      path.includes(`/matches/player/${candidate.puuid}/`),
    );
    if (statsPlayer && path.endsWith("/champion-stats")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          puuid: statsPlayer.puuid,
          total_champions: 1,
          champions: [
            {
              champion_name: "Annie",
              champion_id: 1,
              games_played: 10,
              wins: 6,
              losses: 4,
              win_rate: 0.6,
              avg_kills: 7,
              avg_deaths: 4,
              avg_assists: 8,
              avg_kda: 3.75,
            },
          ],
        }),
      });
      return;
    }

    if (statsPlayer && path.endsWith("/lane-stats")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          puuid: statsPlayer.puuid,
          total_lanes: 1,
          lanes: [
            {
              lane: "Mid",
              games_played: 10,
              wins: 6,
              losses: 4,
              win_rate: 0.6,
              avg_kills: 7,
              avg_deaths: 4,
              avg_assists: 8,
              avg_kda: 3.75,
            },
          ],
        }),
      });
      return;
    }

    if (statsPlayer && path.endsWith("/stats")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          puuid: statsPlayer.puuid,
          total_matches: 10,
          wins: 6,
          losses: 4,
          win_rate: 0.6,
          avg_kills: 7,
          avg_deaths: 4,
          avg_assists: 8,
          avg_kda: 3.75,
          avg_cs: 180,
          avg_vision_score: 24,
        }),
      });
      return;
    }

    if (statsPlayer && path.endsWith("/detailed")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          matches: [],
          total: 0,
          total_analyzed: 0,
          page: 1,
          size: 20,
          pages: 0,
        }),
      });
      return;
    }

    const readPlayer = Object.values(players).find((candidate) =>
      path.endsWith(`/players/${candidate.puuid}`),
    );
    if (readPlayer) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(readPlayer),
      });
      return;
    }

    if (path.includes("/sync") && request.method() === "POST") {
      state.syncStarts += 1;
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

/**
 * Where all four specs start: mocks installed, a viewport short enough that the
 * page scrolls, and the consent banner out of the way.
 */
export async function startAtPlayerOverview(
  page: Page,
  {
    currentPuuid = CURRENT_PUUID,
    viewport = { width: 1440, height: 650 },
  }: {
    currentPuuid?: string;
    viewport?: { width: number; height: number };
  } = {},
): Promise<PlayerContextState> {
  const state = await installPlayerContextMocks(page, { currentPuuid });
  await page.setViewportSize(viewport);
  await page.goto("/player-overview");
  await page.getByRole("button", { name: "Accept all" }).click();
  return state;
}
