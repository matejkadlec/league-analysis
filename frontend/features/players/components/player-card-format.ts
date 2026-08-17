export function getWinRateColor(winRate: number): string {
  if (winRate >= 51) {
    return "text-green-500";
  } else if (winRate > 49) {
    return "text-yellow-500";
  } else {
    return "text-rose-500";
  }
}

export function getWinRateBarColor(winRate: number): string {
  if (winRate >= 51) {
    return "bg-green-500";
  } else if (winRate > 49) {
    return "bg-yellow-500";
  } else {
    return "bg-rose-500";
  }
}

export function formatWinRate(winRate: number): string {
  const percent = winRate <= 1 ? winRate * 100 : winRate;
  const formatted = percent.toFixed(1);
  return formatted.endsWith(".0") ? Math.round(percent).toString() : formatted;
}

export function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return "Never";
  return new Date(dateString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}
