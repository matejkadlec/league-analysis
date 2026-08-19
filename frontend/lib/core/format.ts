/** Shared display formatters over the platform's own Intl machinery. */

// Module-level: Intl formatters are expensive to construct and these are
// called from render paths. `minimumFractionDigits` defaults to 0, so a
// whole number renders "52%" and anything else "52.3%" — no branch needed.
const percentFormatter = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});

/** Format a 0-1 fraction as a percentage: 0.523 -> "52.3%", 0.5 -> "50%". */
export function formatFractionAsPercent(fraction: number): string {
  return percentFormatter.format(fraction);
}

// One copy of the win-rate verdict. This lived in three files with the same
// names meaning two different units (fraction vs percent), and the one
// call site that guessed its unit rendered a sub-1% ranked win rate as 100%.
// The contract everywhere is a 0-1 fraction; the one percent-shaped API
// field (league.win_rate) is normalized in its schema, at the boundary.

/** Text and bar colors for a 0-1 win-rate fraction: green ≥51%, yellow >49%, rose below. */
export function winRateColors(fraction: number): { text: string; bar: string } {
  const percent = fraction * 100;
  if (percent >= 51) return { text: "text-green-500", bar: "bg-green-500" };
  if (percent > 49) return { text: "text-yellow-500", bar: "bg-yellow-500" };
  return { text: "text-rose-500", bar: "bg-rose-500" };
}

/** Text color for a KDA verdict: green ≥3, yellow ≥2, rose below. */
export function kdaColor(kda: number): string {
  if (kda >= 3) return "text-green-500";
  if (kda >= 2) return "text-yellow-500";
  return "text-rose-500";
}

/** Format a KDA ratio for display: always two decimals, "3.37". */
export function formatKDA(kda: number): string {
  return kda.toFixed(2);
}
