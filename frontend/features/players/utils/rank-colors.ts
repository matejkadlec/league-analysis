import type { Tier } from "@/lib/core/schemas";

export interface RankColors {
  gradient: string;
  icon: string;
  text: string;
  badge: string;
}

/**
 * Rank styling per tier, keyed by the tier itself. `PlayerLeagueSchema.tier`
 * is the API's own `Tier` enum, so a `Record<Tier, …>` makes an eleventh tier
 * a type error here. Keep aligned with PlayerCard rank styling.
 */
const RANK_COLORS: Record<Tier, RankColors> = {
  IRON: {
    gradient: "from-gray-400/10 to-gray-500/10",
    icon: "text-gray-400",
    text: "text-gray-300",
    badge: "bg-gray-500/20 text-gray-300",
  },
  BRONZE: {
    gradient: "from-orange-700/10 to-orange-800/10",
    icon: "text-orange-600",
    text: "text-orange-400",
    badge: "bg-orange-700/20 text-orange-400",
  },
  SILVER: {
    gradient: "from-slate-400/10 to-slate-500/10",
    icon: "text-slate-400",
    text: "text-slate-300",
    badge: "bg-slate-500/20 text-slate-300",
  },
  GOLD: {
    gradient: "from-yellow-500/10 to-amber-500/10",
    icon: "text-yellow-500",
    text: "text-yellow-400",
    badge: "bg-yellow-600/20 text-yellow-400",
  },
  PLATINUM: {
    gradient: "from-cyan-500/10 to-teal-500/10",
    icon: "text-cyan-500",
    text: "text-cyan-400",
    badge: "bg-cyan-600/20 text-cyan-400",
  },
  EMERALD: {
    gradient: "from-emerald-500/10 to-green-500/10",
    icon: "text-emerald-500",
    text: "text-emerald-400",
    badge: "bg-emerald-600/20 text-emerald-400",
  },
  DIAMOND: {
    gradient: "from-blue-500/10 to-indigo-500/10",
    icon: "text-blue-500",
    text: "text-blue-400",
    badge: "bg-blue-600/20 text-blue-400",
  },
  MASTER: {
    gradient: "from-purple-500/10 to-fuchsia-500/10",
    icon: "text-purple-500",
    text: "text-purple-400",
    badge: "bg-purple-600/20 text-purple-400",
  },
  GRANDMASTER: {
    gradient: "from-red-500/10 to-rose-500/10",
    icon: "text-red-500",
    text: "text-red-400",
    badge: "bg-red-600/20 text-red-400",
  },
  CHALLENGER: {
    gradient: "from-yellow-400/20 to-orange-500/20 via-red-500/20",
    icon: "text-yellow-400",
    text: "text-transparent bg-clip-text bg-gradient-to-r from-yellow-500 via-red-500 to-orange-500",
    badge:
      "bg-gradient-to-r from-yellow-500/20 via-red-500/20 to-orange-500/20 text-yellow-400 font-bold",
  },
};

export function getRankColors(tier: Tier): RankColors {
  return RANK_COLORS[tier];
}
