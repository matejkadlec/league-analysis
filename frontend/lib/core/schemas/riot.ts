import { z } from "zod";

/** Riot LEAGUE-V4 tiers, matching backend `app.core.enums.Tier`. */
export const TIER_VALUES = [
  "IRON",
  "BRONZE",
  "SILVER",
  "GOLD",
  "PLATINUM",
  "EMERALD",
  "DIAMOND",
  "MASTER",
  "GRANDMASTER",
  "CHALLENGER",
] as const;

export const TierSchema = z.enum(TIER_VALUES);
export type Tier = z.infer<typeof TierSchema>;

/**
 * Tier plus the product bucket for a player with no league entry.
 * LEAGUE-V4 never emits UNRANKED; matchmaking invents it.
 */
export const LobbyTierSchema = z.enum([...TIER_VALUES, "UNRANKED"]);
export type LobbyTier = z.infer<typeof LobbyTierSchema>;

/** LEAGUE-V4 division. Master and above still send `I`. */
export const DivisionSchema = z.enum(["I", "II", "III", "IV"]);
export type Division = z.infer<typeof DivisionSchema>;

/** LEAGUE-V4 `queueType` values this product stores. */
export const LeagueQueueTypeSchema = z.enum([
  "RANKED_SOLO_5x5",
  "RANKED_FLEX_SR",
]);

/** MATCH-V5 Summoner's Rift `teamPosition`. */
export const TeamPositionSchema = z.enum([
  "TOP",
  "JUNGLE",
  "MIDDLE",
  "BOTTOM",
  "UTILITY",
]);

/** Display names `LANE_DISPLAY_NAMES` emits for the five roles. */
export const LaneDisplayNameSchema = z.enum([
  "Top",
  "Jungle",
  "Mid",
  "Bottom",
  "Support",
]);
export type LaneDisplayName = z.infer<typeof LaneDisplayNameSchema>;
