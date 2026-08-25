/**
 * The two API shapes every spec has to answer: the signed-in user behind
 * `/auth/me`, and a tracked player. Specs override only the fields they
 * depend on, so a deliberate difference stays visible.
 */

const baseUser = (now: string) => ({
  id: 7,
  email: "qa@example.test",
  display_name: "QA User",
  is_active: true,
  is_admin: false,
  email_verified: true,
  email_verified_at: now,
  last_login: now,
  riot_account_connected: false,
  puuid: null as string | null,
  created_at: now,
  updated_at: now,
});

export function qaUser(
  now: string,
  overrides: Partial<ReturnType<typeof baseUser>> = {},
) {
  return { ...baseUser(now), ...overrides };
}

const basePlayer = (now: string) => ({
  puuid: "",
  game_name: "",
  tag_line: "",
  platform: "eun1",
  // Required since the DB, the API and zod agreed both are non-null; these are
  // the defaults `resolve_player_display_fields` writes for a player Riot has
  // not been asked about yet.
  summoner_level: 0,
  profile_icon_id: 29,
  is_tracked: true,
  analyzed_matches: 0,
  total_matches: 0,
  profile_synced_at: now,
  league_synced_at: now,
  match_synced_at: now,
  created_at: now,
  updated_at: now,
});

type Player = ReturnType<typeof basePlayer>;

/**
 * Identity is required and everything else defaulted: a player fixture with
 * no puuid answers requests for a player nobody asked about, which fails as
 * an unexplained empty page rather than as a missing argument.
 */
export function trackedPlayer(
  now: string,
  identity: Pick<Player, "puuid" | "game_name" | "tag_line"> & Partial<Player>,
) {
  return { ...basePlayer(now), ...identity };
}
