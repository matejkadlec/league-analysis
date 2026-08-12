# Production Containers and Pi Deployment

> **Authority:** Repository-owned production images, Compose topology,
> deployment execution, container validation, health checks, and the pi5ram16
> runtime boundary.
>
> **Maintenance:** Update whenever a production Dockerfile, Compose service,
> deployment script/workflow, runtime port, health check, or host bootstrap
> requirement changes.

## Native development and container scope

`./run.sh` remains the normal local-development entry point. It runs Uvicorn,
Next.js development mode, and the configured WSL PostgreSQL database directly;
it never invokes Docker or Podman. Production packaging is explicit and
separate:

```bash
./deploy/container-qa.sh
```

That command requires Docker Compose v2 and `ss`. It creates test-only runtime
values, unique container/network/volume names, loopback ports `18097` and
`18098`, and a disposable PostgreSQL database. It validates Compose, builds
both images from the locks, applies all Alembic revisions, waits for real
backend/frontend health, proves PostgreSQL has no host binding, and removes
the isolated stack, volume, and uniquely tagged test images. Override occupied
QA ports without changing the native runtime:

```bash
LGA_CONTAINER_QA_FRONTEND_PORT=28097 \
LGA_CONTAINER_QA_BACKEND_PORT=28098 \
./deploy/container-qa.sh
```

This validation never reads the repository-root `.env` and never attaches to
the native local database.

## Production topology

[`compose.production.yml`](../compose.production.yml) is the sole portable
application-stack definition:

The Pi hosts multiple projects. Never act on an arbitrary container merely
because it has a generic frontend, backend, or PostgreSQL role. Resolve the
exact resource below and verify both its `com.docker.compose.project` label is
`league-analysis` and its `com.docker.compose.service` label matches the
Compose service before an operational change.

| Compose service | Container name | Image | Runtime | Host exposure |
| --- | --- | --- | --- | --- |
| `frontend` | `league-analysis-frontend` | `league-analysis-frontend:<commit>` | Next.js standalone production server on `3000` | `8097` |
| `backend` | `league-analysis-backend` | `league-analysis-backend:<commit>` | One production Uvicorn worker on `8000` | `8098` |
| `postgres` | `league-analysis-postgres` | `postgres:18.4-bookworm` | PostgreSQL `18.4` | none; internal-only |
| `migrate` | one-shot, no fixed name | `league-analysis-backend:<commit>` | locked `migrate.py upgrade head` | none |

Compose service names, container names, and image names are distinct
identities. In particular, `postgres` is the Compose service while
`league-analysis-postgres` is its fixed container name, and the one-shot
`migrate` service deliberately has no fixed container name. Do not substitute
resources from another Pi project.

The frontend and backend run as UID/GID `10001`, with a read-only root
filesystem, `no-new-privileges`, all Linux capabilities dropped, bounded PIDs,
bounded local-driver logs, and writable tmpfs only where required. PostgreSQL
retains the official entrypoint's required privilege boundary and is attached
only to the internal database network. The frontend has no database-network
access.

The data volume is deliberately unnamed in `compose.production.yml`, so Compose
derives it from the project name. Never reintroduce an explicit name or a
`LGA_POSTGRES_VOLUME_NAME` override: on 2026-08-12 a hard-coded name in the
deploy script disagreed with the running stack's volume, and the deploy started
on an empty database.

The backend readiness endpoint is `/health/ready`. It returns success only
after a database round trip. The one-shot migration must finish successfully
before the backend starts, and frontend startup waits for backend readiness.
A migration or health failure therefore fails the deployment rather than
publishing an apparently running but unusable stack.

The frontend image bakes the public browser API origin from
`NEXT_PUBLIC_API_URL`. Its server-side `/api/*` rewrite uses the private
`http://backend:8000` Compose route, so internal traffic does not loop through
the Pi host port.

## Private host configuration

The production target is the ARM64 host identified by the SSH alias and runner
label `pi5ram16`. The repository stores only
[`deploy/production.env.example`](../deploy/production.env.example). On the
host, create the private file without sharing its contents:

```bash
ssh pi5ram16 '
  set -eu
  install -d -m 700 "$HOME/.local/share/league-analysis"
  test ! -e "$HOME/.local/share/league-analysis/production.env"
  install -m 600 /dev/null "$HOME/.local/share/league-analysis/production.env"
  printf "%s\n" "Edit the new file locally from the approved private source."
'
```

Use the example only as a field-name guide. Do not paste the completed file in
chat, Jira, logs, a pull request, or a command whose output echoes values. The
deploy script refuses a missing file, symlink, or mode other than `0600`.
Database/JWT/SMTP/Turnstile/Riot secrets remain runtime environment values and
are never Docker build arguments or image layers. The only frontend build
arguments are intentionally public browser configuration.

The GitHub repository also needs a self-hosted runner registered on that host
with the custom label `pi5ram16`. Runner registration credentials are an owner
configuration action; never put a registration token in repository files or
Jira.

## Deployment flow

The `Deploy to Raspberry Pi` workflow in `.github/workflows/deploy.yml` runs
only for a push to `master` or a manual run whose selected ref is `master`. Its
pull-request trigger intentionally skips the deployment job while still
validating workflow syntax and policy. The workflow checks out the exact event
SHA without persisted credentials and calls the repository-owned script:

```bash
./deploy/production-deploy.sh \
  --source "$GITHUB_WORKSPACE" \
  --commit "$GITHUB_SHA"
```

The script verifies the exact checkout, target repository/ref when GitHub
supplies them, private-file type/mode, and required tools. It then:

1. acquires `$HOME/.local/share/league-analysis/.deploy.lock` without waiting;
2. stages a clean `git archive` of the exact commit under `releases/`;
3. validates Compose without printing interpolated secrets;
4. builds commit-tagged backend/frontend images from the repository Dockerfiles;
5. starts the stack with a five-minute migration and health deadline;
6. proves PostgreSQL has no host port and rechecks both services internally;
7. atomically records the successful release as `current`.

Workflow concurrency queues deployments instead of cancelling an active host
mutation, and the host lock independently prevents two processes from changing
the stack together.

Deployment deliberately does not query, pause, drain, or wait for Match
Fetcher, Player Updater, Matchmaking Analysis, or any other application work.
Scheduler shutdown stops future dispatches with `wait=False`; Docker gives the
backend a bounded grace period. Persisted regular executions interrupted by a
restart are classified `CANCELLED` by startup recovery, which also cancels
every active `jobs.player_sync_runs` row: its worker is in-process, so no row
left active by the previous process can still be owned, and an orphan would
block that player's next update. Active `core.matchmaking_analyses` rows are
deliberately left alone; the next explicit start resumes them.
Only migration, container startup, and service health are deployment gates.

## Verification and diagnostics

Secret-safe runtime checks on `pi5ram16`:

```bash
ssh pi5ram16 'docker ps --filter name=league-analysis --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"'
ssh pi5ram16 'docker inspect --format "{{.Name}} project={{index .Config.Labels \"com.docker.compose.project\"}} service={{index .Config.Labels \"com.docker.compose.service\"}} image={{.Config.Image}}" league-analysis-frontend league-analysis-backend league-analysis-postgres'
ssh pi5ram16 'curl --fail --silent http://127.0.0.1:8098/health/ready'
ssh pi5ram16 'curl --fail --silent http://127.0.0.1:8097/ >/dev/null'
ssh pi5ram16 'docker inspect --format "{{json .HostConfig.PortBindings}}" league-analysis-postgres'
ssh pi5ram16 'docker logs --tail 100 league-analysis-backend'
ssh pi5ram16 'docker logs --tail 100 league-analysis-frontend'
```

Do not run `docker compose config` without `--quiet` against the production
environment because non-quiet output expands runtime values. Never inspect a
container's complete environment.

The historical failed Deploy run used the obsolete `pi5ram16` branch and
repeatedly failed Alembic startup from that stale revision. The current
workflow cannot manually deploy a feature branch and deploys the exact current
`master` SHA, so repository migrations and images advance together.

## PostgreSQL data authority

The Pi database `league_analysis` is authoritative. LGA-79 performed the
one-time transfer from local `league_analysis_local_dev`; that transfer is
complete and its tooling has been removed, so the only remaining paths into the
production database are the reviewed backup and restore commands below.

The Pi tooling resolves only the exact `league-analysis-postgres` container and
verifies its Compose project/service labels plus empty host-port bindings.
PostgreSQL never receives a host port; every operation reaches it through
`docker exec`.


## PostgreSQL daily backups and restore tests

A system-systemd timer named `league-analysis-postgres-backup.timer` runs at
exactly `00:00` in the `Europe/Prague` timezone, including daylight-saving
changes, regardless of the Pi host timezone. `Persistent=true` catches up once
after downtime; the shared non-blocking operations lock prevents overlap with
restore or mirror exports.

It is a system unit, not a user unit, so it needs neither an open login session
nor an enabled linger. The service body runs as the deploying account and
executes the operations script from the live release tree through
`$LGA_DEPLOY_ROOT/current`, so a deployment updates the backup tooling with the
application.

The deployment workflow installs and enables it on every release; install it by
hand with:

```bash
./deploy/install-pi-postgres-backup-timer.sh
```

The installer needs passwordless `sudo` to write `/etc/systemd/system`.

The service verifies the exact Compose project, PostgreSQL service/container,
database name, absent host port, and Alembic head. It writes
a PostgreSQL 18 custom-format gzip archive to a mode-`0700` host directory at
`$HOME/.local/share/league-analysis/backups/postgres`. The dump first uses a
private `.in-progress` file, validates it with `pg_restore --list`, syncs it,
and atomically renames it to this deterministic timestamp shape:

```text
league-analysis-postgres-daily-YYYYMMDDTHHMMSS+ZZZZ.dump
```

Only after that success does retention remove daily archives older than the
newest seven. It matches only exact successful daily filenames. Partial files,
earlier manual archives, and unrelated artifacts neither count toward retention
nor get deleted. Failures are nonzero in the system journal and do not remove a
previous successful backup.

Inspect scheduling and the most recent service result without exposing runtime
configuration:

```bash
systemctl list-timers league-analysis-postgres-backup.timer
systemctl status league-analysis-postgres-backup.service --no-pager
journalctl -u league-analysis-postgres-backup.service -n 50 --no-pager
```

Run an on-demand backup and test a selected daily archive as follows:

```bash
PI_OPERATIONS="$HOME/.local/share/league-analysis/current/deploy/pi-postgres-operations.sh"
"$PI_OPERATIONS" daily-backup --confirm-target league_analysis
"$PI_OPERATIONS" restore-test \
  --confirm-target league_analysis \
  --archive "$HOME/.local/share/league-analysis/backups/postgres/league-analysis-postgres-daily-YYYYMMDDTHHMMSS+ZZZZ.dump"
```

The restore test accepts only a private, current-user-owned daily archive
directly inside the managed backup directory. It creates a generated temporary
database, restores with ownership and ACL replay disabled, validates Alembic,
constraints, application tables, both administrator flags, and a deterministic
snapshot, then drops the temporary database. It never replaces or exposes the
production database. A nonzero restore test preserves the archive and removes
the generated test database through the failure trap.

### Restoring production from a backup

The operations script has no production-restore command. A restore is rare,
destructive, and better done by hand with the restore test as its safety gate.
The database is under 10 MB, so the whole sequence takes about two minutes.

```bash
PI_OPERATIONS="$HOME/.local/share/league-analysis/current/deploy/pi-postgres-operations.sh"
ARCHIVE="$HOME/.local/share/league-analysis/backups/postgres/league-analysis-postgres-daily-YYYYMMDDTHHMMSS+ZZZZ.dump"

# 1. Prove the archive restores cleanly before touching production.
"$PI_OPERATIONS" restore-test --confirm-target league_analysis --archive "$ARCHIVE"

# 2. Back up the database you are about to replace.
"$PI_OPERATIONS" safety-backup --label pre-restore --confirm-target league_analysis

# 3. Replace it.
docker stop league-analysis-frontend league-analysis-backend
docker exec --user postgres league-analysis-postgres dropdb --force league_analysis
docker exec --user postgres league-analysis-postgres createdb --template template0 league_analysis
docker exec --interactive --user postgres league-analysis-postgres \
  pg_restore --dbname league_analysis --no-owner --no-privileges --exit-on-error < "$ARCHIVE"
docker start league-analysis-backend league-analysis-frontend
```

Step 1 is the check that matters: it restores the same archive into a throwaway
database and verifies the Alembic head, constraints, application tables, both
administrators, and a deterministic snapshot. If it passes, step 3 will too.

To undo a completed restore, repeat the sequence with the `pre-restore` archive
written in step 2. Retention never prunes `pre-restore` archives, so that file
stays on disk indefinitely.

## Recurring Pi-to-local mirror

The only automatic data direction is:

```text
pi5ram16 league_analysis -> local league_analysis_local_dev
```

The local database is disposable development data. Intentional local changes
can be overwritten at the next refresh. The mirror implementation contains no
remote restore, replacement, backup, or mutating SQL command: over SSH it may
request only secret-safe `identity`, the read-only deterministic `snapshot`,
and the authority-gated read-only `mirror-dump`. PostgreSQL stays internal to
the Pi container.

Run the worktree command without `--apply` for a read-only preflight, then use
the same implementation on demand:

```bash
./backend/scripts/mirror_pi_postgres_to_local.py \
  --database league_analysis_local_dev \
  --remote pi5ram16 \
  --remote-database league_analysis \
  --config .env

./backend/scripts/mirror_pi_postgres_to_local.py \
  --database league_analysis_local_dev \
  --remote pi5ram16 \
  --remote-database league_analysis \
  --config .env \
  --apply
```

No password is accepted on the command line. The private config must be a
current-user-owned, non-symlink regular file with mode `0600`; the target must
be the configured PostgreSQL 18 loopback database in the `dev` environment.
The Pi identity must match the exact League Analysis container/project/service,
database, Alembic head, and absent host binding.

An apply first compares the deterministic Pi and local snapshots. An exact
match skips the dump, transfer, restore, and swap. A mismatch streams a complete
custom-format archive using mirror-specific Zstandard level 3 compression;
daily backups retain their stronger gzip level 9 contract. The complete archive
is downloaded and validated before any local database change. It restores into
a generated staging database, validates the migration head, constraints, both
administrators, all table counts and sequence states, disables connections
during the short rename window, and atomically swaps database names. A private
durable state file restores the previous local database after termination or
validation failure. The old local database is dropped only after the new target
validates. A Pi write immediately after a matching fingerprint can be delayed
until the next five-minute check; it can never cause a partial local snapshot.
Active local backend connections are terminated only for a changed snapshot and
reconnect to the new target; restart a development session if its connection
pool does not recover cleanly.

Install a worktree-independent snapshot and the local user-systemd timer:

```bash
./deploy/install-local-postgres-mirror.sh
```

The default recurrence is every five minutes on an explicit
`Europe/Prague` calendar. `Persistent=true` runs one missed refresh when the
local machine next becomes available, and the non-blocking lock rejects overlap.
The cheap snapshot comparison normally avoids the approximately 20 MB archive
transfer and full local restore when nothing changed. The manual and automatic
paths execute the same installed implementation. Inspect them without printing
configuration values:

```bash
systemctl --user list-timers league-analysis-local-postgres-mirror.timer
systemctl --user status league-analysis-local-postgres-mirror.service --no-pager
journalctl --user -u league-analysis-local-postgres-mirror.service -n 50 --no-pager

$HOME/.local/share/league-analysis/operations/local-postgres-mirror \
  --database league_analysis_local_dev \
  --remote pi5ram16 \
  --remote-database league_analysis \
  --config "$HOME/projects/league-analysis/.env" \
  --apply
```

To configure a different local cadence without changing the implementation,
create a systemd user override with `systemctl --user edit
league-analysis-local-postgres-mirror.timer`, clear the inherited schedule with
an empty `OnCalendar=`, add one explicit timezone-aware `OnCalendar=`, then run
`systemctl --user daemon-reload` and restart the timer.

## Failure and recovery boundary

Build, migration, container-start, or health failure exits nonzero with bounded
service status/log diagnostics. The last successful `current` release and
commit-tagged images remain available, and the persistent database volume is
never removed by deployment. Do not use `docker compose down --volumes` on the
production stack.

The deployment script does not automatically reverse database migrations or
delete releases/images. Daily archives and their isolated restore test do not
by themselves select a compatible application release or authorize a production
restore. Broader disaster-recovery and release-rollback policy remains owned by
LGA-16; recovery is an explicit owner operation based on a verified database
backup and compatible prior release. Never guess or reset a populated schema.
