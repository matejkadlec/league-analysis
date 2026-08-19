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
