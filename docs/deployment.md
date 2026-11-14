# Production Deployment

> **Authority:** The production images, the Compose stack, the deployment and
> backup commands, the host tenant, and the operating procedures of
> <https://league.matejkadlec.cz>.
>
> **Maintenance:** Update when a production Dockerfile, a Compose service, a
> command under `deploy/`, the deploy workflow, or an operating procedure
> changes. The files themselves say what they do; this document records why,
> and what an operator has to know.

`./run.sh` remains the local-development entry point and never touches Docker.
Everything here is the separate, explicit production path.

## What runs where

Production is a private, login-only installation on `matejkadlec-cz1`, a FORPSI
server shared with other sites. League Analysis is one tenant there. It owns
exactly this, and nothing else on the host belongs to it:

- the locked account `lga-deploy` (no password, no sudo, no extra groups) with
  its own rootless Docker daemon, kept running across reboots by lingering;
- a CPU and memory ceiling on that account's systemd slice, so an image build
  or a runaway job cannot starve the other sites;
- `/srv/league-analysis/` (repository mirror, releases, state, database dumps)
  and `/etc/league-analysis/` (private configuration);
- `/usr/local/libexec/league-analysis-deploy` and
  `/usr/local/libexec/league-analysis-backup`, root-owned copies of the two
  commands in [`deploy/`](../deploy/);
- the Cloudflare Tunnel `league-analysis-production`.

[`deploy/provision-server.sh`](../deploy/provision-server.sh) creates all of it
and can be run again. It installs no package and changes no host-wide setting.
Ask the owner before anything host-wide (packages, SSH daemon, firewall, other
accounts); the other tenants' rules are theirs.

## The stack

[`compose.production.yml`](../compose.production.yml) is the only definition of
the stack. No service publishes a host port.

| Service | What it is | Networks |
| --- | --- | --- |
| `cloudflared` | Tunnel connector, the only way in | `edge` |
| `frontend` | Next.js standalone server | `edge`, `application` |
| `backend` | FastAPI, one Uvicorn worker | `application`, `database` |
| `migrate` | One-shot `migrate.py upgrade head` | `database` |
| `postgres` | PostgreSQL 18 | `database` (no route out) |

Decisions that are not obvious from the file:

- **One public route.** The tunnel's public hostname points at
  `http://frontend:3000` and nothing else. The browser calls `/api/v1`
  same-origin and Next.js forwards it to `http://backend:8000` over the
  `application` network, so the API never faces the tunnel and no CORS or
  cross-site cookie question arises.
- **Only `/api/v1` is forwarded.** The API serves its interactive documentation
  at `/api` and its schema at `/openapi.json`. Neither is reachable from
  outside; both answer 404 at the interface.
- **Exactly one API container with one worker.** The scheduler and the job
  runtime live in that process, so a second one would be a second job runner.
  The fixed `container_name` makes a second container impossible under any
  project name. On every deployment and rollback the deploy command stops the
  old container and confirms it is gone before starting the next one; Docker
  kills it after `stop_grace_period`.
- **Migration gates startup.** `migrate` must exit successfully before
  `backend` starts, `backend` must answer `/health/ready` (a database round
  trip) before `frontend` starts, and the deployment fails otherwise.
- **The client address is the visitor's.** Uvicorn trusts `X-Forwarded-For`
  only from the two internal networks and skips their addresses when reading
  it, so the address Cloudflare appended is what rate limits and the access log
  see. Server-side requests made by Next.js itself carry no such header and
  count as the interface.
- **The deployment id is the commit.** `NEXT_DEPLOYMENT_ID` is baked into the
  interface image, so a tab opened before a deployment reloads instead of
  asking the new origin for chunks it no longer has.
- **Build arguments are public.** `NEXT_PUBLIC_*` values (API and site origin,
  indexing off, no Turnstile site key) and the deployment id are baked in by
  `next build` and visible to every browser. No secret is a build argument or
  an image layer.
- **Hardening.** The API and the interface run as UID 10001 on a read-only
  root filesystem with all capabilities dropped, `no-new-privileges`, bounded
  PIDs, memory, CPU and logs. PostgreSQL keeps the five capabilities its
  entrypoint needs to hand the data directory to the `postgres` user.

## The database volume

The data lives in the Docker volume `league-analysis-postgres-data`. That name
is written once, in `compose.production.yml`, where the volume is declared
`external`: Compose refuses to start when it is missing instead of creating an
empty one. The deploy command reads the name from Compose's resolved
configuration and never carries a copy.

On 2026-08-12, on the previous host, a volume name supplied through an
environment variable disagreed with the running stack and a deployment started
on an empty database. Three things prevent a repeat:

1. the Compose file interpolates only the release and the private
   configuration directory, so no variable can rename anything;
2. only `league-analysis-deploy init`, an administrator operation that refuses
   to run twice, creates the volume;
3. a deployment refuses when the host was never initialized, when the volume
   is missing, and when the database inside it is empty.

Never run `docker compose down --volumes` or `docker volume rm` on this host.

## Private configuration

`/etc/league-analysis/` is owned by `lga-deploy` with mode 0700, each file
0600. Nothing in it enters Git, GitHub, an image, a log or a chat.

| File | Content | Written by |
| --- | --- | --- |
| `postgres.env` | `POSTGRES_PASSWORD` | provisioning, generated |
| `backend.env` | `JWT_SECRET_KEY`; optional mail and Turnstile settings | provisioning, generated |
| `restic-password` | Backup repository password | provisioning, generated |
| `backup.env` | Bucket and its credentials, see [`backup.env.example`](../deploy/backup.env.example) | the owner |
| `cloudflared-token` | Tunnel token | the owner |

Provisioning never replaces an existing file. The database password is also
stored inside the volume, and the restic password is the only key to the
backups: **keep a copy of `restic-password` in a password manager.**

Email delivery and Turnstile are off. To enable either, add the names from
[`backend/app/core/config.py`](../backend/app/core/config.py) to `backend.env`
and redeploy; a Turnstile site key is additionally a build argument in the
Compose file.

To write a secret without showing it, run this on the host and paste the value
at the silent prompt:

```bash
read -rs VALUE && printf '%s\n' "$VALUE" | sudo -u lga-deploy sh -c \
  'umask 077 && cat > /etc/league-analysis/cloudflared-token' && unset VALUE
```

## Deploying

A push to `master` runs the Quality Checks workflow. When both of its jobs
pass, [`deploy.yml`](../.github/workflows/deploy.yml) connects with the SSH key
of the GitHub environment `production`. That environment admits `master` only
and holds:

| Kind | Name |
| --- | --- |
| Secret | `DEPLOY_SSH_PRIVATE_KEY`, `DEPLOY_SSH_HOST`, `DEPLOY_SSH_HOST_KEY` |
| Variable | `DEPLOY_SSH_USER`, `DEPLOY_SSH_PORT` |

The host and its key line are secrets because this repository's workflow logs
are public and a step's variables are printed in them.

On the server the key can run one thing, the forced command
`league-analysis-deploy`, with `deploy <commit>` or `status`. The command:

1. fetches the commit from GitHub over HTTPS and requires it to be on `master`;
2. skips the rest when the commit changed nothing under `backend/`, `frontend/`
   or the Compose file, because restarting the API would only interrupt the
   jobs running inside it;
3. builds both images, with the old release still serving;
4. dumps the database to `/srv/league-analysis/backups/pre-deploy/` and keeps
   the newest three dumps;
5. stops the old API, then starts the release and waits for the migration and
   every health check, then requests `/api/v1/auth/me` through the interface;
6. on failure, stops the new API, starts the previous release again and fails
   the workflow.

A rollback restores the previous images, not the previous schema: migrations
are not reversed. If a migration was not backward compatible, restore the
pre-deployment dump named in the failure message by hand.

By hand, "Run workflow" on the Deploy workflow redeploys `master`. On the host:

```bash
sudo -u lga-deploy /usr/local/libexec/league-analysis-deploy status
sudo -u lga-deploy /usr/local/libexec/league-analysis-deploy deploy <commit> [<branch>]
```

The second form rolls back, or deploys a pushed branch. Changing either command
or the deploy key is deliberately not automated: copy `deploy/` to the host and
run `sudo ./provision-server.sh ./deploy-key.pub`.

### First deployment on a new host

```bash
sudo ./provision-server.sh ./deploy-key.pub
sudo -u lga-deploy /usr/local/libexec/league-analysis-deploy init <commit> [<branch>]
# import data here, if any, while the API is not running
sudo -u lga-deploy /usr/local/libexec/league-analysis-deploy deploy <commit> [<branch>]
```

`init` creates the volume, starts PostgreSQL and migrates the empty database,
and leaves the API stopped. Store the tunnel token before or after; the
connector joins the stack on the first deployment that finds the token.

## Accounts

There is no registration. `POST /api/v1/auth/register` was removed because it
created an active account for any anonymous caller; a test keeps it gone. The
operator creates every account from the host, with a hidden password prompt:

```bash
sudo -u lga-deploy /usr/local/libexec/league-analysis-deploy account \
  --email you@example.com --display-name "Your Name" --admin
```

Leave out `--admin` for a regular user. Add `--update` to change an existing
account's password, name or role, which also clears a lockout and ends that
account's sessions. The Riot API key is entered by an administrator in the
application's Settings, never in a file.

The QA fixture accounts documented for local development must never exist
here; see [Public Source Release](public-release.md).

## Backups

[`league-analysis-backup`](../deploy/league-analysis-backup) writes encrypted
`restic` snapshots to a bucket on FORPSI Object Storage that belongs to League
Analysis alone, with its own access key. The repository password is separate
from the bucket credentials. Three systemd user timers of `lga-deploy` run it
(Europe/Prague, up to ten minutes of jitter):

| Timer | When | Operation |
| --- | --- | --- |
| `league-analysis-backup` | daily 03:10 | Dump, validate, upload; keep 7 daily, 4 weekly, 12 monthly |
| `league-analysis-backup-check` | daily 09:30 | Last backup under 26 hours old, present remotely, 5% of the data read back |
| `league-analysis-restore-rehearsal` | monthly, the 2nd, 04:30 | Restore the latest snapshot into a throwaway PostgreSQL with no network; compare the Alembic revision, table count and row count |

Each operation records its outcome in `/srv/league-analysis/state/backups/`,
and a failure replaces the earlier success. `league-analysis-deploy status`
prints the three records. Nothing sends an alert yet, so look at `status` after
changing anything about backups.

Setting up storage, once per bucket or credential rotation:

1. In the FORPSI panel create one private bucket for League Analysis and an
   access key that can list, read, write and delete in that bucket only.
2. Write `/etc/league-analysis/backup.env` from the example, without echoing
   the secret key, with the `read -rs` pattern above.
3. Run `init`, `run`, `check` and `rehearse` once each, in that order:
   `sudo -u lga-deploy /usr/local/libexec/league-analysis-backup <operation>`.
4. Only then enable the timers, as `lga-deploy`:
   `systemctl --user enable --now league-analysis-backup.timer league-analysis-backup-check.timer league-analysis-restore-rehearsal.timer`.

Restoring production is deliberately not a command. Rehearse the snapshot, take
a fresh dump, stop the API, and restore by hand with `pg_restore`.

## Checking the stack

```bash
sudo -u lga-deploy /usr/local/libexec/league-analysis-deploy status
```

For anything more, act as the account against its own daemon:

```bash
sudo -u lga-deploy env XDG_RUNTIME_DIR=/run/user/$(id -u lga-deploy) \
  DOCKER_HOST=unix:///run/user/$(id -u lga-deploy)/docker.sock \
  docker logs --tail 100 league-analysis-backend
```

Never print a container's environment and never run `docker compose config`
without `--quiet` against production: both show the private values.

## Validating a change before it ships

```bash
./deploy/container-qa.sh
```

builds both images and exercises a disposable copy of the stack under its own
project, container and volume names ([`deploy/compose.qa.yml`](../deploy/compose.qa.yml)):
routing, the closed documentation and registration routes, the security
headers, the forwarded client address, hardening, the account command and a
login. CI runs it on every pull request, on the architecture production uses.
