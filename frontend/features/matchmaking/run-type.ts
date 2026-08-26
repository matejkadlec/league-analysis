import type { MatchmakingAnalysisParams } from "@/lib/core/schemas";

/** Human form of one run's params, e.g. "10 · latest", "30 · before Jul 26, 2026". */
export function formatRunType(params: MatchmakingAnalysisParams): string {
  if (!params.end_date) {
    return `${params.match_count} · latest`;
  }
  const day = new Date(`${params.end_date}T00:00:00Z`).toLocaleDateString(
    "en-US",
    { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" },
  );
  return `${params.match_count} · before ${day}`;
}
