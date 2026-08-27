import { z } from "zod";

import { PLATFORMS } from "@/lib/core/platform-utils";

import { paginationFields } from "./common";
import { LaneDisplayNameSchema, TeamPositionSchema } from "./riot";

export const MatchSchema = z.object({
  match_id: z.string(),
  platform: z.enum(PLATFORMS),
  game_creation_timestamp: z.number().int(),
  game_start_timestamp: z.number().int(),
  game_start_timestamp_source: z.enum([
    "riot_game_start",
    "legacy_game_creation",
  ]),
  game_duration: z.number().int(),
  queue_id: z.number().int(),
  game_version: z.string(),
  map_id: z.number().int(),
  game_mode: z.string(),
  game_type: z.string(),
  game_end_timestamp: z.number().int(),
  early_surrender: z.boolean(),
  surrender: z.boolean(),
  game_result: z.string().optional().nullable(),
  fully_analyzed: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const ParticipantRunesSchema = z.object({
  primary_style: z.number().int().optional().nullable(),
  sub_style: z.number().int().optional().nullable(),
  keystone: z.number().int().optional().nullable(),
});

export type ParticipantRunes = z.infer<typeof ParticipantRunesSchema>;

export const PlayerMatchParticipantSchema = z.object({
  champion_id: z.number().int(),
  champion_name: z.string(),
  champion_level: z.number().int(),
  team_position: TeamPositionSchema.optional().nullable(),
  team_id: z.number().int(),
  win: z.boolean(),
  remake: z.boolean().default(false),
  kills: z.number().int().default(0),
  deaths: z.number().int().default(0),
  assists: z.number().int().default(0),
  kda: z.number(),
  total_cs: z.number().int().default(0),
  vision_score: z.number().int().default(0),
  total_damage_dealt_to_champions: z.number().int().default(0),
  summoner1_id: z.number().int().optional().nullable(),
  summoner2_id: z.number().int().optional().nullable(),
  runes: ParticipantRunesSchema.optional().nullable(),
});

// The three identity fields live here and not on
// `PlayerMatchParticipantSchema`: the backend publishes them only on the
// opponent, so the omit base would claim a shape the player never sends.
export const EnemyLaneOpponentSchema = PlayerMatchParticipantSchema.omit({
  team_position: true,
  team_id: true,
  win: true,
  remake: true,
}).extend({
  puuid: z.string(),
  game_name: z.string(),
  tag_line: z.string(),
});

export const TeamStatsSchema = z.object({
  kills: z.number().int().default(0),
  deaths: z.number().int().default(0),
  assists: z.number().int().default(0),
  turrets: z.number().int().nullable().optional(),
  inhibitors: z.number().int().nullable().optional(),
  dragons: z.number().int().nullable().optional(),
  barons: z.number().int().default(0),
  rift_heralds: z.number().int().default(0),
  voidgrubs: z.number().int().nullable().optional(),
});

export type TeamStats = z.infer<typeof TeamStatsSchema>;

export const TeamStatsCompositionSchema = z.object({
  blue_team: TeamStatsSchema,
  red_team: TeamStatsSchema,
});

export const TeamChampionSchema = z.object({
  champion_id: z.number().int(),
  champion_name: z.string(),
  team_position: TeamPositionSchema.optional().nullable(),
  puuid: z.string(),
  game_name: z.string(),
  tag_line: z.string(),
});

export const TeamCompositionSchema = z.object({
  blue_team: z.array(TeamChampionSchema),
  red_team: z.array(TeamChampionSchema),
});

export const MatchWithPlayerDataSchema = MatchSchema.extend({
  player_participant: PlayerMatchParticipantSchema.optional().nullable(),
  lane_opponent: EnemyLaneOpponentSchema.optional().nullable(),
  lp_change: z.number().int().optional().nullable(),
  team_compositions: TeamCompositionSchema.optional().nullable(),
  team_stats: TeamStatsCompositionSchema.optional().nullable(),
});

// The four counters every paginated endpoint answers with, mirroring the
// backend's `PaginatedResponse`. Spelled once so a page cannot mean `size`
// here and `page_size` there.
export const MatchListWithPlayerDataResponseSchema = z.object({
  matches: z.array(MatchWithPlayerDataSchema),
  total_analyzed: z.number().int().optional().default(0),
  ...paginationFields,
});

// The win/loss and per-game averages the backend returns for every stats
// grouping -- overall, per champion, per lane. Spelled once so a new metric
// cannot land on two of the three.
const performanceStatsFields = {
  wins: z.number().int(),
  losses: z.number().int(),
  win_rate: z.number(),
  avg_kills: z.number(),
  avg_deaths: z.number(),
  avg_assists: z.number(),
  avg_kda: z.number(),
} as const;

/** The figures `PerformanceFigures` renders, whichever grouping they describe. */
export type PerformanceStats = z.infer<z.ZodObject<typeof performanceStatsFields>>;

export const MatchStatsResponseSchema = z.object({
  puuid: z.string(),
  total_matches: z.number().int(),
  ...performanceStatsFields,
  avg_cs: z.number(),
  avg_vision_score: z.number(),
});

export const ChampionStatsItemSchema = z.object({
  champion_name: z.string(),
  champion_id: z.number().int(),
  games_played: z.number().int(),
  ...performanceStatsFields,
});

export type ChampionStatsItem = z.infer<typeof ChampionStatsItemSchema>;

export const ChampionStatsResponseSchema = z.object({
  puuid: z.string(),
  total_champions: z.number().int(),
  champions: z.array(ChampionStatsItemSchema),
});

export type ChampionStatsResponse = z.infer<typeof ChampionStatsResponseSchema>;

export const LaneStatsItemSchema = z.object({
  lane: LaneDisplayNameSchema,
  games_played: z.number().int(),
  ...performanceStatsFields,
});

export type LaneStatsItem = z.infer<typeof LaneStatsItemSchema>;

export const LaneStatsResponseSchema = z.object({
  puuid: z.string(),
  total_lanes: z.number().int(),
  lanes: z.array(LaneStatsItemSchema),
});

export type LaneStatsResponse = z.infer<typeof LaneStatsResponseSchema>;

export type Match = z.infer<typeof MatchSchema>;
export type MatchStatsResponse = z.infer<typeof MatchStatsResponseSchema>;
export type PlayerMatchParticipant = z.infer<
  typeof PlayerMatchParticipantSchema
>;
export type EnemyLaneOpponent = z.infer<typeof EnemyLaneOpponentSchema>;
export type TeamChampion = z.infer<typeof TeamChampionSchema>;
export type MatchWithPlayerData = z.infer<typeof MatchWithPlayerDataSchema>;
