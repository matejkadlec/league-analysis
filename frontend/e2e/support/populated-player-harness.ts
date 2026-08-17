import type { Page } from "@playwright/test";

import { seedAuthenticatedSession } from "./auth";

/**
 * A player with enough stored data that every table, row and stat block on the
 * player-centric pages actually renders.
 *
 * The overflow these fixtures exist to catch is invisible against an empty
 * database: with no champions, lanes or matches, the wide descendants are
 * never mounted and the page measures exactly the viewport. So this harness
 * fills each surface rather than merely answering each request.
 */

export const NOW = "2026-08-14T10:00:00.000Z";
export const PUUID = "populated-player-puuid";

// Riot's own champion keys, which is what the backend stores and what the
// Data Dragon image URL is built from; a display spelling would 404 the icon
// and quietly change the width being measured.
const CHAMPIONS = [
  ["AurelionSol", 136],
  ["Kaisa", 145],
  ["Nunu", 20],
  ["Renata", 888],
  ["TwistedFate", 4],
  ["MissFortune", 21],
] as const;

const LANES = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"] as const;

export const player = {
  puuid: PUUID,
  // Riot IDs run to 16 characters, and a long one is what pushes a name column
  // out; a short fixture name would hide the very thing being measured.
  game_name: "Longest Name Here",
  tag_line: "EUNE1",
  platform: "eun1",
  summoner_level: 412,
  profile_icon_id: 4568,
  is_tracked: true,
  analyzed_matches: 126,
  total_matches: 126,
  profile_synced_at: NOW,
  league_synced_at: NOW,
  match_synced_at: NOW,
  created_at: NOW,
  updated_at: NOW,
};

const league = {
  puuid: PUUID,
  league_id: "league-id",
  queue_type: "RANKED_SOLO_5x5",
  tier: "EMERALD",
  rank: "II",
  league_points: 74,
  wins: 70,
  losses: 56,
  veteran: false,
  inactive: false,
  fresh_blood: false,
  hot_streak: true,
  created_at: NOW,
  win_rate: 70 / 126,
  total_games: 126,
  display_rank: "Emerald II",
};

const stats = {
  puuid: PUUID,
  total_matches: 126,
  wins: 70,
  losses: 56,
  win_rate: 70 / 126,
  avg_kills: 7.4,
  avg_deaths: 5.1,
  avg_assists: 9.8,
  avg_kda: 3.37,
  avg_cs: 187.6,
  avg_vision_score: 22.4,
};

const championStats = {
  puuid: PUUID,
  total_champions: CHAMPIONS.length,
  champions: CHAMPIONS.map(([champion_name, champion_id], index) => ({
    champion_name,
    champion_id,
    games_played: 30 - index * 4,
    wins: 18 - index * 2,
    losses: 12 - index * 2,
    win_rate: 0.6 - index * 0.03,
    avg_kills: 8.2 - index * 0.4,
    avg_deaths: 4.9,
    avg_assists: 10.1,
    avg_kda: 3.7 - index * 0.2,
  })),
};

const laneStats = {
  puuid: PUUID,
  total_lanes: LANES.length,
  lanes: LANES.map((lane, index) => ({
    lane,
    games_played: 40 - index * 6,
    wins: 24 - index * 3,
    losses: 16 - index * 3,
    win_rate: 0.6 - index * 0.04,
    avg_kills: 7.7 - index * 0.3,
    avg_deaths: 5.2,
    avg_assists: 9.4,
    avg_kda: 3.3 - index * 0.15,
  })),
};

function teamChampion(index: number, teamId: number) {
  const [champion_name, champion_id] = CHAMPIONS[index % CHAMPIONS.length]!;
  return {
    champion_id,
    champion_name,
    team_position: LANES[index % LANES.length]!,
    puuid: `${teamId}-${index}`,
  };
}

function match(index: number) {
  const start = Date.parse(NOW) - index * 3_600_000;
  const [champion_name, champion_id] = CHAMPIONS[index % CHAMPIONS.length]!;
  const [opponent_name, opponent_id] = CHAMPIONS[(index + 1) % CHAMPIONS.length]!;
  return {
    match_id: `EUN1_${7000000000 + index}`,
    platform: "eun1",
    game_creation_timestamp: start,
    game_start_timestamp: start,
    game_start_timestamp_source: "riot_game_start" as const,
    game_duration: 1_840 + index * 17,
    queue_id: 420,
    game_version: "26.16.1",
    map_id: 11,
    game_mode: "CLASSIC",
    game_type: "MATCHED_GAME",
    game_end_timestamp: start + 1_840_000,
    early_surrender: false,
    surrender: false,
    game_result: index % 2 === 0 ? "WIN" : "LOSS",
    fully_analyzed: true,
    created_at: NOW,
    updated_at: NOW,
    lp_change: index % 2 === 0 ? 24 : -18,
    player_participant: {
      champion_id,
      champion_name,
      champion_level: 18,
      team_position: LANES[index % LANES.length]!,
      team_id: 100,
      win: index % 2 === 0,
      remake: false,
      kills: 12,
      deaths: 4,
      assists: 14,
      kda: 6.5,
      total_cs: 241,
      vision_score: 31,
      total_damage_dealt_to_champions: 34_812,
      summoner1_id: 4,
      summoner2_id: 14,
    },
    lane_opponent: {
      champion_id: opponent_id,
      champion_name: opponent_name,
      champion_level: 17,
      kills: 6,
      deaths: 9,
      assists: 8,
      kda: 1.6,
      total_cs: 198,
      vision_score: 24,
    },
    team_compositions: {
      blue_team: [0, 1, 2, 3, 4].map((slot) => teamChampion(slot, 100)),
      red_team: [1, 2, 3, 4, 5].map((slot) => teamChampion(slot, 200)),
    },
    team_stats: {
      blue_team: {
        kills: 42,
        deaths: 31,
        assists: 88,
        turrets: 9,
        inhibitors: 2,
        dragons: 3,
        barons: 1,
        rift_heralds: 2,
        voidgrubs: 5,
      },
      red_team: {
        kills: 31,
        deaths: 42,
        assists: 61,
        turrets: 4,
        inhibitors: 0,
        dragons: 1,
        barons: 0,
        rift_heralds: 0,
        voidgrubs: 1,
      },
    },
  };
}

const matchList = {
  matches: [0, 1, 2, 3, 4].map(match),
  total: 126,
  total_analyzed: 126,
  page: 0,
  size: 25,
  pages: 6,
};

const matchmakingAnalysis = {
  puuid: PUUID,
  status: "completed" as const,
  progress: 50,
  total_puuids: 50,
  results: {
    team_avg_winrate: 0.4812,
    enemy_avg_winrate: 0.5431,
    matches_analyzed: 10,
  },
  created_at: NOW,
  started_at: NOW,
  completed_at: NOW,
  requests_saved: 41,
};

const matchmakingHistory = {
  items: [0, 1, 2, 3, 4].map((index) => ({
    created_at: new Date(Date.parse(NOW) - index * 86_400_000).toISOString(),
    team_avg_winrate: 0.48 + index * 0.004,
    enemy_avg_winrate: 0.54 - index * 0.003,
    gap: -0.06 + index * 0.007,
  })),
};

/** Route every request the player-centric pages make to a populated fixture. */
export async function installPopulatedPlayerMocks(page: Page): Promise<void> {
  await seedAuthenticatedSession(page);
  await page.addInitScript(() => {
    localStorage.setItem("theme", "dark");
  });

  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(body),
      });

    if (path.endsWith("/auth/me")) {
      return json({
        id: 7,
        email: "qa@example.test",
        display_name: "QA User",
        is_active: true,
        is_admin: false,
        email_verified: true,
        email_verified_at: NOW,
        last_login: NOW,
        riot_account_connected: false,
        puuid: null,
        created_at: NOW,
        updated_at: NOW,
      });
    }

    if (
      path.endsWith("/players/context") ||
      path.endsWith("/players/context/current")
    ) {
      return json({ current_player: player, tracked_players: [player] });
    }

    if (path.endsWith("/players/tracked/list")) {
      return json([player]);
    }

    if (path.endsWith(`/players/${PUUID}/league`)) {
      return json(league);
    }

    if (path.endsWith("/sync/active")) {
      return json(null);
    }

    if (path.endsWith(`/players/${PUUID}`)) {
      return json(player);
    }

    if (path.endsWith("/champion-stats")) {
      return json(championStats);
    }

    if (path.endsWith("/lane-stats")) {
      return json(laneStats);
    }

    if (path.endsWith("/detailed")) {
      return json(matchList);
    }

    if (path.endsWith("/stats")) {
      return json(stats);
    }

    if (path.endsWith("/matchmaking-analysis/player/" + PUUID + "/history")) {
      return json(matchmakingHistory);
    }

    if (
      path.endsWith("/latest-completed") ||
      path.endsWith("/status") ||
      path.endsWith(`/matchmaking-analysis/player/${PUUID}`)
    ) {
      return json(matchmakingAnalysis);
    }

    if (path.endsWith("/settings/card-preferences")) {
      return json([]);
    }

    if (path.endsWith("/settings/service-status")) {
      return json({
        is_under_maintenance: false,
        reason: "ok",
        active_source: "db",
        credential_status: "valid",
        health_revision: 3,
        observed_at: NOW,
        has_recent_recovery: false,
        recovery_notice_key: null,
      });
    }

    if (path.endsWith("/settings/user/cookie-consent")) {
      return json({});
    }

    return route.fulfill({ status: 404, body: "Not found" });
  });
}
