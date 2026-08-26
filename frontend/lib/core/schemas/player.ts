import { z } from "zod";

import { PLATFORMS } from "@/lib/core/platform-utils";

import { DivisionSchema, LeagueQueueTypeSchema, TierSchema } from "./riot";

export { TierSchema, type Tier } from "./riot";

// Player Schema
export const PlayerSchema = z.object({
  puuid: z.string(),
  game_name: z.string(),
  tag_line: z.string(),
  // Derived from the display-name table rather than listed again: the two
  // used to be sixteen codes typed twice, checked in neither direction.
  platform: z.enum(PLATFORMS),
  summoner_level: z.number().int(),
  profile_icon_id: z.number().int(),
  is_tracked: z.boolean().optional().default(false),
  analyzed_matches: z.number().int().optional().default(0),
  total_matches: z.number().int().optional().default(0),
  last_playstyle_analysis: z.string().optional().nullable(),
  last_matchmaking_analysis: z.string().optional().nullable(),
  profile_synced_at: z.string().optional().nullable(),
  league_synced_at: z.string().optional().nullable(),
  match_synced_at: z.string().optional().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type Player = z.infer<typeof PlayerSchema>;

export const PlayerContextSchema = z.object({
  current_player: PlayerSchema.nullable(),
});

export type PlayerContext = z.infer<typeof PlayerContextSchema>;

export const PlayerSyncRunSchema = z.object({
  id: z.number().int(),
  puuid: z.string(),
  status: z.enum([
    "pending",
    "running",
    "completed",
    "failed",
    "cancelled",
    "rate_limited",
  ]),
  match_execution_id: z.number().int().nullable().optional(),
  profile_execution_id: z.number().int().nullable().optional(),
  error_code: z.string().nullable().optional(),
  error_message: z.string().nullable().optional(),
  created_at: z.string(),
  started_at: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
  updated_at: z.string(),
});

export type PlayerSyncRun = z.infer<typeof PlayerSyncRunSchema>;

export const PlayerLeagueSchema = z.object({
  puuid: z.string(),
  queue_type: LeagueQueueTypeSchema,
  tier: TierSchema,
  rank: DivisionSchema.nullable(),
  league_points: z.number().int(),
  wins: z.number().int(),
  losses: z.number().int(),
  created_at: z.string(),
  // The API serves this one win rate as a percentage (PlayerLeague.win_rate
  // multiplies by 100); every sibling win_rate field is a 0-1 fraction, so
  // it is normalized here, at the boundary, and the app sees one unit.
  win_rate: z.number().transform((percent) => percent / 100),
  total_games: z.number().int(),
  display_rank: z.string(),
});

export type PlayerLeague = z.infer<typeof PlayerLeagueSchema>;

export const CurrentPlayerUpdateSchema = z.object({
  puuid: z.string().nullable().optional(),
});
export type CurrentPlayerUpdate = z.infer<typeof CurrentPlayerUpdateSchema>;
