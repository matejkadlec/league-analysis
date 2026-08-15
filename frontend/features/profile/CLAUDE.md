# Profile feature (features/profile/)

Player Overview statistics cards:

- Cards render aggregate statistics for the globally selected player.
- Top Champions: exactly five champion rows per local page with a stable card
  height on a partial final page — the backend returns the complete ordered
  aggregate and the card paginates locally.
- Win-rate colors: green >55%, yellow 50-55%, red <50%.
- Updated timestamps follow the freshness rules in `../CLAUDE.md`. The
  configurable-card contract is
  [`docs/card-configuration.md`](../../../docs/card-configuration.md).
