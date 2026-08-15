# Riot API client (app/core/riot_api/)

- Both rate-limit layers are mandatory: per-client windows (routing/service
  scoped, original observed start) and database coordination across
  components. Never bypass acquisition/recording, spacing, `Retry-After`, or
  429 behavior.
- Only a direct `2xx`/`404` validates the current key generation and only
  `401`/`403` invalidates it. Rate limits, upstream failures, cached reads and
  lifecycle results are neutral evidence — keep the generation and timestamp
  guards so a stale response cannot overwrite a newer verdict.
- The Riot queue reference catalog stays separate from the product allowlist
  (420, 440, 480, 400, 450, 2400). Reject unknown queue/type/platform inputs
  before I/O; Match Fetcher always consumes the complete allowlist.
