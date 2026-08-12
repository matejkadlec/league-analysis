# Database Schema

> **Authority:** Durable database invariants, rationale, and operational
> procedures. Ordered Alembic revisions in
> [`../backend/alembic/versions/`](../backend/alembic/versions/) are the
> executable schema source of truth; consult them (and the SQLAlchemy models)
> for tables, columns, enums, indexes, and constraints.
>
> **Maintenance:** Update this document only when a durable invariant, a
> decision's rationale, an external or production fact, or an operational
> procedure changes. Mechanical schema changes belong in a reviewed Alembic
> revision, not here.

**Database**: PostgreSQL 18 · **ORM**: SQLAlchemy 2.0+ · **Schemas**: `auth`, `core`, `jobs`

## Schema Authority and Migration Rules

- Never use `Base.metadata.create_all()`, direct schema-reset scripts, or an
  unverified `alembic stamp` against a populated database. Never reset, drop,
  or recreate populated schemas. SQLAlchemy metadata supports revision
  generation but never creates application tables at runtime.
- The initial baseline revision intentionally has no downgrade because
  dropping the application schemas is unsafe. Restore a verified backup when
  reversal is required.
- Apply reviewed revisions only through
  `backend/scripts/migrate.py` (`uv run python scripts/migrate.py upgrade head`).
  It holds a session-scoped PostgreSQL advisory lock so two application
  containers cannot race migrations. `../run.sh` runs it before starting
  backend writers and cancels startup on failure; the production Compose
  contract runs it in a one-shot `migrate` service that must succeed before
  the backend starts. Deploying a stale feature-branch image is forbidden —
  the pi5ram16 workflow deploys the exact current `master` revision so every
  referenced migration is present.
- A new revision also requires updating the expected snapshot tuple in
  `backend/scripts/validate_migrations.py`; the backend test gate validates the
  baseline on a clean isolated database.

## Durable Data Invariants

### PUUIDs are per developer account; duplicate players are never auto-merged

A stored PUUID is only valid under the developer account that fetched it (see
[`riot-api.md`](riot-api.md#puuids-are-bound-to-the-developer-account)). After
a key switch, re-searching a player creates a **separate** `core.players` row
under the new PUUID. Discovery must never merge the old row into the new one
automatically: `players.puuid` cascades into matches, timelines, leagues, and
analyses, so a wrong merge deletes history unrecoverably. An operator
reconciles duplicates deliberately. Revision `20260812_0009` dropped the
case-normalized Riot-ID lookup index that only the removed automatic merge
used.

### Product queue set

The only product-supported queues are **420, 440, 480, 400, 450, 2400**
(Ranked Solo/Duo, Ranked Flex, Swiftplay, Normal Draft, ARAM, ARAM: Mayhem),
defined once as `PRODUCT_SUPPORTED_QUEUE_IDS` in
`backend/app/core/riot_api/constants.py`. Match Fetcher queue selection is not
configurable; historical `enabled_queue_ids` config values are ignored and
stripped (see [`jobs.md`](jobs.md)).

### Versioned user card preferences coexist

`auth.user_card_preferences` has primary key (`user_id`, `card_id`,
`version`) precisely so a future-version row can coexist with v1. v1 reads
ignore future-version rows, v1 upsert/reset touch only the v1 row and preserve
any future-version row, and attempts to write an unsupported version are
rejected — so a rollback to v1 code never discards a later compatible
server's settings. A preference never contains a PUUID, Riot ID, match data,
or another user's identifier.

### Freshness timestamps advance only on clean success

`core.players.profile_synced_at`, `league_synced_at`, and `match_synced_at`
advance only when the owning provider check completes without a recoverable
failure — including a clean check that found nothing new. Failed, cancelled,
warning-bearing, or rate-limited work must not advance the affected timestamp,
because these values drive staleness decisions.

### Other invariants worth knowing

- `core.player_leagues` is immutable rank history: one snapshot row per rank
  change, no primary key by design; `league_id` is nullable because current
  by-PUUID responses may omit it.
- `core.matches` keeps both `game_creation_timestamp` and
  `game_start_timestamp` with a `game_start_timestamp_source` marker
  (`riot_game_start` vs `legacy_game_creation`), so the provenance of every
  ordering/analysis anchor is inspectable without a bulk provider refetch.
- `core.riot_credential_health` (revision `20260812_0008`) is a singleton,
  secret-free record: it stores no key value or key-derived fingerprint, and
  provider evidence is accepted only for the current random `generation` and
  in timestamp order, making key replacement race-safe against concurrent
  request completion.
- One-active-row-per-PUUID partial unique indexes guard both
  `jobs.player_sync_runs` and `core.matchmaking_analyses`; their lifecycle
  contracts are in [`jobs.md`](jobs.md).

## Local Riot-Data Cleanse and QA Fixtures (LGA-11)

`backend/scripts/cleanse_local_riot_data.py` is the only reviewed maintenance
command for the local Riot-data reset. It deletes Riot-derived tables in
FK-safe order, clears Riot links from accounts, preserves application/job
configuration and execution history plus revoked access-token blacklist
entries, and resets the documented local-only fixtures (admin
`mat.kadlec@email.cz`, client `scipiocz@gmail.com` — never valid outside local
development).

Safety contract (read-only by default; all checked before a session opens):
explicit `ENVIRONMENT=dev`; `POSTGRES_HOST`, every PostgreSQL
`listen_addresses` bind, and the active listener loopback-only; `--database`
exactly matching `POSTGRES_DB`; the reviewed application tables present.
`--apply` additionally requires a canonical backup path outside the repository
whose parent and non-sticky directory ancestors are not group/other-writable.
The command blocks writers to every table it will change before taking the
custom-format `pg_dump`, keeps those locks through the cleanup transaction,
and creates a new owner-only `0600` archive with no-follow semantics before
`pg_dump` receives any database data. It re-verifies the archive's descriptor
identity and permissions before `pg_restore --list`; if the filesystem cannot
honor them, it securely removes only that verified file and refuses before any
database mutation. It also clears all saved Riot PUUID URL preferences while
preserving settings rows and revoked access-token blacklist entries.

```bash
cd backend
uv run python scripts/cleanse_local_riot_data.py \
  --database league_analysis_local_dev

install -d -m 700 "$HOME/.local/state/league-analysis/backups"
uv run python scripts/cleanse_local_riot_data.py \
  --database league_analysis_local_dev \
  --apply \
  --backup-path "$HOME/.local/state/league-analysis/backups/pre-lga-11.dump"

uv run python scripts/cleanse_local_riot_data.py \
  --database league_analysis_local_dev \
  --resume-writers
```

Before an apply it locks the two writer job tables, refuses if a regular Match
Fetcher or Player Updater execution is `RUNNING`/`PAUSED`, requires exactly
one configuration per writer type, and persists the `riot_maintenance_mode`
interlock on them. **The interlock deliberately stays enabled after cleanup**
so the emptied database cannot be immediately repopulated; only
`--resume-writers` clears it. The jobs API cannot create or clear it —
`preserve_riot_writer_maintenance_mode` in
`backend/app/features/jobs/maintenance.py` enforces that on every
configuration update.

Never point this command at production, a shared environment, a remote host,
or a database whose identity cannot be proven. Restore the verified backup
instead of attempting an ad-hoc reversal.

## Data Authority: Pi Is Authoritative (LGA-79)

The LGA-79 authority transfer moved `league_analysis_local_dev` to pi5ram16
via a complete PostgreSQL custom-format dump restored into a staging database
and swapped in only after a deterministic source/restored snapshot matched.
The pre-existing Pi database was retained as a private safety backup and
rollback database. Procedure, authority marker, and rollback commands:
[`deployment.md`](deployment.md#postgresql-data-authority-and-initial-migration).

Since then the data flow is strictly one-way:
`pi5ram16 league_analysis -> local league_analysis_local_dev`, refreshed every
five minutes. The local database is **disposable** — the mirror may overwrite
any local rows — and there is no local-to-Pi write path. Details:
[`deployment.md`](deployment.md#recurring-pi-to-local-mirror).

### Pi backups: intended, not verified as installed

The documented intent is one private custom-format backup at
`00:00 Europe/Prague` retaining the seven newest successful daily archives,
installed via `deploy/install-pi-postgres-backup-timer.sh` with isolated
restore verification. **The timer is not currently installed on pi5ram16** —
verify installation before relying on automatic backups. Contract and
diagnostics:
[`deployment.md`](deployment.md#postgresql-daily-backups-and-restore-tests).
