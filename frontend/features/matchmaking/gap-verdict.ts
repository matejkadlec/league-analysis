import { formatFractionAsPercent } from "@/lib/core/format";

/**
 * How a win-rate gap (ally average minus enemy average) reads for the analyzed
 * player. The result cards and the history list both use this, with the same
 * fairness band, so a colour means the same thing on both (LGA-135).
 */
export const GAP_FAIRNESS_THRESHOLD = 0.03;

const GOOD = "text-green-400";
const BAD = "text-red-400";

export interface GapVerdict {
  /** "favorable" reads from the analyzed player's side of the gap. */
  verdict: "favorable" | "unfavorable" | "fair";
  /** Text colour for the gap and the verdict; none for a fair gap. */
  tone: string;
  /** The same reading without colour, shown next to every coloured gap. */
  symbol: "✓" | "✗" | "≈";
  label: "Favorable" | "Unfavorable" | "Fair";
}

export function gapVerdict(gap: number): GapVerdict {
  if (Math.abs(gap) < GAP_FAIRNESS_THRESHOLD) {
    return { verdict: "fair", tone: "", symbol: "≈", label: "Fair" };
  }
  return gap > 0
    ? { verdict: "favorable", tone: GOOD, symbol: "✓", label: "Favorable" }
    : { verdict: "unfavorable", tone: BAD, symbol: "✗", label: "Unfavorable" };
}

/** A gap as the signed figure both surfaces print, e.g. "+6.2%" or "−3%". */
export function formatSignedGap(gap: number): string {
  const magnitude = formatFractionAsPercent(Math.abs(gap));
  // A gap that rounds away gets no sign: "+0%" claims a direction it lacks.
  if (magnitude === formatFractionAsPercent(0)) {
    return magnitude;
  }
  return `${gap > 0 ? "+" : "−"}${magnitude}`;
}
