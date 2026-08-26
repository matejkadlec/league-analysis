import type { MatchmakingAnalysisParams } from "@/lib/core/schemas";

/** UTC render of a run's end date; the backend window is on-or-before this day. */
export function formatRunEndDate(endDate: string): string {
  return new Date(`${endDate}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Human form of one run's params, e.g. "10 · latest", "30 · through Jul 26, 2026". */
export function formatRunType(params: MatchmakingAnalysisParams): string {
  if (!params.end_date) {
    return `${params.match_count} · latest`;
  }
  return `${params.match_count} · through ${formatRunEndDate(params.end_date)}`;
}
