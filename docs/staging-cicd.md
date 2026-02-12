# Staging CI/CD (GitHub Actions)

This project supports automated staging deployment on every push to `master` (including merged PRs) using:

- Workflow: `.github/workflows/deploy-staging.yml`
- Target host: `142.93.173.113`
- Target path: `/srv/league-analysis`
- Remote deploy command: `sudo /usr/local/bin/league-deploy.sh`

## Workflow behavior

1. Run quality checks:
   - `frontend`: `npm run lint` + `npx tsc --noEmit`
   - `backend`: `uv run pyright`
2. Sync repository to staging server via `rsync`.
3. Execute server-side deploy script to:
   - sync Python dependencies,
   - install frontend dependencies,
   - build Next.js,
   - copy standalone static/public assets,
   - restart `league-backend` and `league-frontend` systemd services.

## Required GitHub repository secrets

- `STAGING_SSH_HOST` = `142.93.173.113`
- `STAGING_SSH_USER` = `ops`
- `STAGING_SSH_PRIVATE_KEY` = private key for a dedicated deploy key
- `STAGING_SSH_KNOWN_HOSTS` = output of `ssh-keyscan -H 142.93.173.113`

## Server prerequisites

Run once on staging host:

- Create `/usr/local/bin/league-deploy.sh` (root-owned executable).
- Allow `ops` to run it without password via `/etc/sudoers.d/league-deploy`:

```bash
ops ALL=(root) NOPASSWD: /usr/local/bin/league-deploy.sh
```

Validate with:

```bash
sudo visudo -cf /etc/sudoers.d/league-deploy
```

## Notes

- Keep production secrets only in server env (`/etc/league-analysis/staging.env`) and GitHub Secrets.
- Do not commit API keys or credentials to repo-tracked files.
- Production Riot API key is read from DB (`core.riot_api_keys`), not from server env.
