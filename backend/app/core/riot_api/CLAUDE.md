# Riot API client (app/core/riot_api/)

- Regional routing for Account-V1 and Match-V5; platform routing for
  Summoner-V4 and League-V4. PUUID is the durable player identifier. Async
  HTTP, DTO-validated responses.
- Both rate-limit layers are mandatory: per-client windows (routing/service
  scoped, original observed start) and database coordination across
  components. Never bypass acquisition/recording, spacing, `Retry-After`, or
  429 behavior.
- Credentials via `create_tracked_riot_api_client()`: active non-expired
  `core.riot_api_keys` row wins, `RIOT_API_KEY` fallback. Direct `2xx`/`404`
  validate the current generation; `401`/`403` invalidate it; rate limits,
  upstream failures, cached reads, and lifecycle results are neutral. Keep the
  generation/timestamp guards so stale requests cannot overwrite evidence.
  Never log or expose an API key.
- The Riot queue reference catalog stays separate from the product allowlist
  (420, 440, 480, 400, 450, 2400). Reject unknown queue/type/platform inputs
  before I/O; Match Fetcher always consumes the complete allowlist.
