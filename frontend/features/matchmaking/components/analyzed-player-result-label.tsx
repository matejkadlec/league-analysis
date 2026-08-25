/**
 * The "Results for player X" line above matchmaking analysis output. Shared by
 * the results card and the history list so the two cannot drift --
 * `e2e/player-context.spec.ts` matches this exact sentence.
 */
export function AnalyzedPlayerResultLabel({
  playerLabel,
}: {
  playerLabel: string;
}) {
  return (
    <p className="text-sm">
      <span style={{ color: "var(--color-muted-foreground)" }}>
        Results for player{" "}
      </span>
      <span style={{ color: "var(--color-card-foreground)" }}>
        {playerLabel}
      </span>
    </p>
  );
}
