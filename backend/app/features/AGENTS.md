# Features (`app/features/`)

> **Scope:** Backend domain-feature boundaries and cross-feature invariants
> under `backend/app/features/`.
>
> **Maintenance:** Update when a dependency rule or a cross-feature invariant
> changes. The feature inventory and per-feature structure live in the code
> (`features/<name>/`: `__init__.py`, `router.py`, `service.py`, `models.py`,
> `schemas.py`, `dependencies.py`).

Inherits repository-wide rules from [`../../../AGENTS.md`](../../../AGENTS.md)
and backend rules from [`../../AGENTS.md`](../../AGENTS.md).

## Rules

- Features depend on `core/`, optionally on other features; minimize
  cross-feature dependencies. Features expose public APIs via `__init__.py`.
  Keep routes thin, logic in services.
- Player records, matches, and freshness timestamps remain shared by PUUID.
  Current selection, tracked mappings, and recent ordering are always scoped by
  authenticated application user ID. Never infer one from the other.
- Match History queue unions and champion/player search filter stored matches
  before totals and offset/limit pagination. Participant search covers every
  participant's champion name and Riot ID, while the requested player PUUID is
  enforced independently; this database-only read path never calls Riot.
- Match History reads the LP value persisted on the requested player's match
  participant. Never derive LP during reads from shared league snapshots or
  invent a historical value; unknown and ambiguous observations stay null.
- `discover_player` never merges two player rows. A row carrying the same Riot
  ID under a different PUUID is left alone, and a duplicate row is the accepted
  outcome. Discovery cannot distinguish a PUUID re-encrypted under a new
  developer account from a Riot ID renamed away and reclaimed by someone else,
  and every table referencing `core.players(puuid)` cascades on delete, so a
  wrong merge would move one player's history onto another and delete the
  original. Do not reintroduce an automatic repoint-and-delete path, and do not
  treat a `PuuidDecryptionError` on the superseded PUUID as authorization: it
  proves the stored PUUID belongs to another account namespace, not that the
  name-resolved PUUID is the same Riot account. Repair a stale population
  through an explicit operator-run pass with a reviewed mapping instead; see
  [`../../../docs/riot-api.md`](../../../docs/riot-api.md).
- Matchmaking Analysis start routes must return the persisted active run before
  Riot preflight/work begins. Preserve its explicit lifecycle states, one-active-
  run-per-PUUID database constraint, exact-run cancellation, and shared
  rate-limiter/maintenance boundaries. Any `AuthenticationError` or
  `ForbiddenError`, including during optional cache filling, must terminate with
  `error_code=RIOT_API_KEY_INVALID` so the shared frontend credential warning
  survives the background-run HTTP 200 polling boundary.
- Settings exposes the same backend-owned credential source, status, and health
  revision to admins and non-admins. Job history and browser memory are never
  credential-health authority; all effective provider clients must use the
  tracked core factory.
- The retired `/settings/user` theme/default-platform contract is compatibility
  only: bounded legacy payloads are accepted and ignored, fixed defaults are
  returned, and no database value may alter player search or theme behavior.
