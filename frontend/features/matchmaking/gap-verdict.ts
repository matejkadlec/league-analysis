/**
 * Which side of a win-rate gap counts as good news, and how big it has to be.
 * The two surfaces answer it differently on purpose -- the results card leaves
 * a gap under three points uncoloured, the history table colours every gap --
 * and here that disagreement is one argument rather than two rebuilt pairs.
 */
export const GAP_FAIRNESS_THRESHOLD = 0.03;

const GOOD = "text-green-400";
const BAD = "text-red-400";

export interface GapVerdict {
  /** "favorable" reads from the analyzed player's side of the gap. */
  verdict: "favorable" | "unfavorable" | "fair";
  ally: string;
  enemy: string;
}

export function gapVerdict(gap: number, threshold: number): GapVerdict {
  if (Math.abs(gap) < threshold) {
    return { verdict: "fair", ally: "", enemy: "" };
  }
  return gap > 0
    ? { verdict: "favorable", ally: GOOD, enemy: BAD }
    : { verdict: "unfavorable", ally: BAD, enemy: GOOD };
}
