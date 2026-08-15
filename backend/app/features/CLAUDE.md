# Backend features (app/features/)

`features/<name>/`: `__init__.py`, `router.py`, `service.py`, `models.py`,
`schemas.py`, `dependencies.py`. Thin routers, logic in services, public APIs
via `__init__.py`; minimize cross-feature dependencies.

- Player records, matches, and freshness timestamps are shared by PUUID;
  current selection, tracked mappings, and recent ordering are scoped by
  authenticated application user ID. Never infer one from the other.
- Matchmaking Analysis start routes return the persisted active run before
  Riot preflight/work begins. Preserve the explicit lifecycle states, the
  one-active-run-per-PUUID constraint, exact-run cancellation, and the shared
  rate-limiter/maintenance boundaries. Any `AuthenticationError`/
  `ForbiddenError` — including during optional cache filling — terminates with
  `error_code=RIOT_API_KEY_INVALID` so the frontend credential warning
  survives the background-run HTTP 200 polling boundary.
- Settings exposes the same backend-owned credential source, status, and
  health revision to admins and non-admins. The retired `/settings/user`
  theme/default-platform contract is compatibility-only.
