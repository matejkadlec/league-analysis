/**
 * Which side of a win-rate gap counts as good news, and how big it has to be.
 *
 * Two surfaces of this feature answered that question separately and answered
 * it differently: the results card treats a gap under three points as fair and
 * leaves it uncoloured, the history table colours every gap. Both are
 * deliberate today -- the history file said so in a comment -- but the
 * disagreement was buried in two files that each rebuilt the same green/red
 * pair. Here it is one argument.
 */
export const GAP_FAIRNESS_THRESHOLD = 0.03;

const GOOD = "text-green-600 dark:text-green-400";
const BAD = "text-red-600 dark:text-red-400";

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
