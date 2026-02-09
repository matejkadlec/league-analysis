export interface RankColors {
  gradient: string;
  icon: string;
  text: string;
  badge: string;
}

// Keep color mapping aligned with PlayerCard rank styling.
export function getRankColors(tier: string): RankColors {
  const normalizedTier = tier.toUpperCase();

  switch (normalizedTier) {
    case "IRON":
      return {
        gradient: "from-gray-400/10 to-gray-500/10",
        icon: "text-gray-500 dark:text-gray-400",
        text: "text-gray-700 dark:text-gray-300",
        badge: "bg-gray-500/20 text-gray-700 dark:text-gray-300",
      };
    case "BRONZE":
      return {
        gradient: "from-orange-700/10 to-orange-800/10",
        icon: "text-orange-700 dark:text-orange-600",
        text: "text-orange-800 dark:text-orange-400",
        badge: "bg-orange-700/20 text-orange-800 dark:text-orange-400",
      };
    case "SILVER":
      return {
        gradient: "from-slate-400/10 to-slate-500/10",
        icon: "text-slate-500 dark:text-slate-400",
        text: "text-slate-700 dark:text-slate-300",
        badge: "bg-slate-500/20 text-slate-700 dark:text-slate-300",
      };
    case "GOLD":
      return {
        gradient: "from-yellow-500/10 to-amber-500/10",
        icon: "text-yellow-600 dark:text-yellow-500",
        text: "text-yellow-700 dark:text-yellow-400",
        badge: "bg-yellow-600/20 text-yellow-700 dark:text-yellow-400",
      };
    case "PLATINUM":
      return {
        gradient: "from-cyan-500/10 to-teal-500/10",
        icon: "text-cyan-600 dark:text-cyan-500",
        text: "text-cyan-700 dark:text-cyan-400",
        badge: "bg-cyan-600/20 text-cyan-700 dark:text-cyan-400",
      };
    case "EMERALD":
      return {
        gradient: "from-emerald-500/10 to-green-500/10",
        icon: "text-emerald-600 dark:text-emerald-500",
        text: "text-emerald-700 dark:text-emerald-400",
        badge: "bg-emerald-600/20 text-emerald-700 dark:text-emerald-400",
      };
    case "DIAMOND":
      return {
        gradient: "from-blue-500/10 to-indigo-500/10",
        icon: "text-blue-600 dark:text-blue-500",
        text: "text-blue-700 dark:text-blue-400",
        badge: "bg-blue-600/20 text-blue-700 dark:text-blue-400",
      };
    case "MASTER":
      return {
        gradient: "from-purple-500/10 to-fuchsia-500/10",
        icon: "text-purple-600 dark:text-purple-500",
        text: "text-purple-700 dark:text-purple-400",
        badge: "bg-purple-600/20 text-purple-700 dark:text-purple-400",
      };
    case "GRANDMASTER":
      return {
        gradient: "from-red-500/10 to-rose-500/10",
        icon: "text-red-600 dark:text-red-500",
        text: "text-red-700 dark:text-red-400",
        badge: "bg-red-600/20 text-red-700 dark:text-red-400",
      };
    case "CHALLENGER":
      return {
        gradient: "from-yellow-400/20 to-orange-500/20 via-red-500/20",
        icon: "text-yellow-500 dark:text-yellow-400",
        text: "text-transparent bg-clip-text bg-gradient-to-r from-yellow-500 via-red-500 to-orange-500",
        badge:
          "bg-gradient-to-r from-yellow-500/20 via-red-500/20 to-orange-500/20 text-yellow-600 dark:text-yellow-400 font-bold",
      };
    default:
      return {
        gradient: "from-gray-500/10 to-gray-600/10",
        icon: "text-gray-600 dark:text-gray-500",
        text: "text-gray-700 dark:text-gray-400",
        badge: "bg-gray-600/20 text-gray-700 dark:text-gray-400",
      };
  }
}

