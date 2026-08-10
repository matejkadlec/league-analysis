# Production Containers and Pi Deployment

> **Authority:** Repository-owned production images, Compose topology,
> deployment execution, container validation, health checks, and the pi5ram8
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
retains the official entrypoint's required privilege boundary, stores data in
the named `league-analysis-postgres-data` volume, and is attached only to the
internal database network. The frontend has no database-network access.

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
label `pi5ram8`. The repository stores only
[`deploy/production.env.example`](../deploy/production.env.example). On the
host, create the private file without sharing its contents:

```bash
ssh pi5ram8 '
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
with the custom label `pi5ram8`. Runner registration credentials are an owner
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
restart are classified `CANCELLED` by startup recovery, and persisted
application-run lifecycles retain their existing cancellation/retry behavior.
Only migration, container startup, and service health are deployment gates.

## Verification and diagnostics

Secret-safe runtime checks on `pi5ram8`:

```bash
ssh pi5ram8 'docker ps --filter name=league-analysis --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"'
ssh pi5ram8 'docker inspect --format "{{.Name}} project={{index .Config.Labels \"com.docker.compose.project\"}} service={{index .Config.Labels \"com.docker.compose.service\"}} image={{.Config.Image}}" league-analysis-frontend league-analysis-backend league-analysis-postgres'
ssh pi5ram8 'curl --fail --silent http://127.0.0.1:8098/health/ready'
ssh pi5ram8 'curl --fail --silent http://127.0.0.1:8097/ >/dev/null'
ssh pi5ram8 'docker inspect --format "{{json .HostConfig.PortBindings}}" league-analysis-postgres'
ssh pi5ram8 'docker logs --tail 100 league-analysis-backend'
ssh pi5ram8 'docker logs --tail 100 league-analysis-frontend'
```

Do not run `docker compose config` without `--quiet` against the production
environment because non-quiet output expands runtime values. Never inspect a
container's complete environment.

The historical failed Deploy run used the obsolete `pi5ram16` branch and
repeatedly failed Alembic startup from that stale revision. The current
workflow cannot manually deploy a feature branch and deploys the exact current
`master` SHA, so repository migrations and images advance together.

## Failure and recovery boundary

Build, migration, container-start, or health failure exits nonzero with bounded
service status/log diagnostics. The last successful `current` release and
commit-tagged images remain available, and the persistent database volume is
never removed by deployment. Do not use `docker compose down --volumes` on the
production stack.

The deployment script does not automatically reverse database migrations or
delete releases/images. Full backup, restore, retention, and rollback policy
remain owned by LGA-16. Until that runbook is complete, recovery is an explicit
owner operation based on a verified database backup and compatible prior
release; never guess or reset a populated schema.
