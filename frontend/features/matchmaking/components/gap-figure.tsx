import { cn } from "@/lib/core/utils";

import { formatSignedGap, gapVerdict } from "../gap-verdict";

/**
 * A win-rate gap in both readings at once: the colour, and a symbol and sign
 * that say the same to anyone who cannot tell the colours apart. The result
 * cards and the history list both print gaps through this.
 */
export function GapFigure({ gap }: { gap: number }) {
  const { tone, symbol, label } = gapVerdict(gap);
  return (
    <span className={cn("whitespace-nowrap", tone)}>
      <span aria-hidden="true">{symbol} </span>
      {formatSignedGap(gap)}
      <span className="sr-only"> ({label})</span>
    </span>
  );
}
