# Riot API Client (`app/core/riot_api/`)

> **Scope:** Riot HTTP client, routing, DTOs, transformations, and rate-limit
> infrastructure under `backend/app/core/riot_api/`.
>
> **Maintenance:** Update when a routing, credential, contract-tolerance, or
> rate-limit boundary changes. Module responsibilities and endpoint signatures
> live in the code in this directory.

Inherits repository-wide rules from
[`../../../../AGENTS.md`](../../../../AGENTS.md), backend rules from
[`../../../AGENTS.md`](../../../AGENTS.md), and core dependency boundaries from
[`../AGENTS.md`](../AGENTS.md).

## Boundaries

- Use regional routing for Account-V1 and Match-V5 and platform routing for
  Summoner-V4 and League-V4.
- Use PUUID as the durable player identifier.
- Keep HTTP I/O async and validate responses through the DTO layer.
- Treat Account-V1 `gameName`/`tagLine` and mode-sensitive participant fields
  as optional. Missing identity fields must preserve a known Riot ID; legacy
  `summonerName` is only a new-record/display fallback.
- Keep the Riot queue reference catalog separate from the product allowlist
  (420, 440, 480, 400, 450, 2400). Reject unknown queue/type/platform inputs
  before I/O. Match Fetcher always consumes the complete product allowlist;
  persisted job configuration cannot narrow it.
- Treat `leagueId` and `puuid` as optional metadata in League-V4 by-PUUID
  entries. Keep queue and ranked-result fields strict so genuine response-shape
  drift remains visible without rejecting the current payload.
- Preserve both rate-limit layers. Per-client windows are routing/service
  scoped and keep their original observed start; database coordination keeps
  cross-component priority. Do not bypass acquisition/recording, spacing,
  `Retry-After`, or 429 behavior.
- Resolve effective runtime credentials with
  `create_tracked_riot_api_client()`: an active, non-expired
  `core.riot_api_keys` row has priority, with `RIOT_API_KEY` as the fallback.
  Direct `2xx`/`404` responses validate the current generation; `401`/`403`
  invalidate it. Rate limits, upstream/network failures, cached reads, and
  application lifecycle results are neutral. Keep generation and timestamp
  guards so stale requests cannot overwrite current evidence.
- Never log or expose an API key.
- A Riot 400 whose `status.message` reports a decryption failure becomes
  `PuuidDecryptionError`, not a plain `BadRequestError`. It means the stored
  PUUID belongs to another developer account. Keep the condition on the
  exception type and keep the provider payload out of the message.

[`../../../../docs/riot-api.md`](../../../../docs/riot-api.md) records the
durable routing, credential, contract, and rate-limit invariants; update it
only when one of those changes.
