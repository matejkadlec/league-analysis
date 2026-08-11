# Runtime and Dependency Upgrade Review (2026-08-11)

> **Authority:** Dated maintenance-refresh record. The live manifests and
> lockfiles remain authoritative after this review. The prior baseline is
> [`dependency-upgrade-2026-08-03.md`](dependency-upgrade-2026-08-03.md).

## Method and selection rules

The baseline is the version resolved by `origin/master` at commit `fadd7c1`,
not only the lower bound written in a manifest. Target versions and publication
dates were queried from the official npm registry, PyPI, Docker Hub, the
Node.js distribution index, and the linked GitHub releases on 2026-08-11.

Only stable releases were selected. This refresh is deliberately a maintenance
round: every component that was already the latest stable release was retained
without change, so no framework, runtime major, or database major moved. Every
manifest floor that previously equalled its locked version was raised to the
new locked version, keeping the established exact-floor convention.

Primary release sources include [Python 3.14.7], the [Node.js release
schedule], [PostgreSQL 18.4], [PyPI], [npm], [Docker `dockerfile` frontend
releases], and the linked GitHub releases in the tooling matrix.

[Python 3.14.7]: https://www.python.org/downloads/release/python-3147/
[Node.js release schedule]: https://nodejs.org/en/about/previous-releases
[PostgreSQL 18.4]: https://www.postgresql.org/docs/current/release-18-4.html
[PyPI]: https://pypi.org/
[npm]: https://www.npmjs.com/
[Docker `dockerfile` frontend releases]: https://github.com/moby/buildkit/releases

## Runtimes, package managers, CI, and repository tools

| Component | Baseline | Selected target and release date | Breaking changes, migration, and rationale |
| --- | --- | --- | --- |
| Python | 3.14.6 | 3.14.7 (2026-08-05) | Maintenance patch inside the supported 3.14 line; no 3.15 stable release exists. `.python-version`, `requires-python`, both backend image stages, and the CI `PYTHON_VERSION` moved together. |
| Node.js | 26.7.0 | 26.7.0 (2026-07-29) | Retained: latest published Node 26 release. Node 26 is still current, not LTS; no newer major exists. |
| npm | 12.0.2 | 12.0.2 (2026-07-29) | Retained latest stable CLI. `packageManager`, `devEngines`, `engines`, the frontend image, and both CI jobs stay identical. |
| uv | 0.12.1 in CI, 0.12.3 in the backend image | 0.12.3 (2026-08-06) | Pre-1.0 minor. CI now pins the same exact release the production image already used, removing the split. uv 0.12.3 also supplies the managed Python 3.14.7 build the pinned runtime requires. |
| PostgreSQL | 18.4 | 18.4 (2026-05-14) | Retained: latest 18 minor. A major move would require a `pg_upgrade` or dump/restore of the production volume and is out of scope for a maintenance refresh. |
| `docker/dockerfile` frontend | 1.18 | 1.26 (2026-07-29) | Both Dockerfiles moved to the current stable BuildKit frontend. The syntax used by the images is unchanged; the isolated container QA build validates the new frontend. |
| Base images | `python:3.14.6-slim-bookworm`, `node:26.7.0-bookworm-slim`, `postgres:18.4-bookworm` | `python:3.14.7-slim-bookworm`, `node:26.7.0-bookworm-slim`, `postgres:18.4-bookworm` | Only the Python base moved. Distribution stays Bookworm for every image. |
| `actions/checkout` | 7.0.1 | 7.0.1 (2026-07-20) | Retained latest stable immutable commit pin. |
| `actions/setup-node` | 7.0.0 | 7.0.0 (2026-07-14) | Retained latest stable immutable commit pin. |
| `astral-sh/setup-uv` | 9.0.0 | 9.0.0 (2026-07-21) | Retained latest stable immutable commit pin; only its `version` input moved to 0.12.3. |
| `pre-commit-hooks` | 6.0.0 | 6.0.0 (2025-08-09) | Retained latest stable hook release. |
| `ruff-pre-commit` | 0.16.1 | 0.16.2 (2026-08-07) | Moved with the backend Ruff pin so the hook and the gate stay byte-identical in behavior. |

## Backend direct dependencies

All target dates are PyPI publication dates. A “compatible update” required no
application migration beyond a lock refresh and the backend gate; any observed
breakage would have blocked the target. Direct requirements not listed here
were already at their latest stable release and are retained unchanged:
APScheduler 3.11.3, asyncpg 0.31.0, email-validator 2.3.0, FastAPI 0.141.1,
httpx 0.28.1, passlib[argon2] 1.7.4, psycopg2-binary 2.9.12, Pydantic 2.13.4,
python-dotenv 1.2.2, PyJWT[crypto] 2.13.0, python-multipart 0.0.32,
slowapi 0.1.10, SQLAlchemy 2.0.51, structlog 26.1.0, uvicorn[standard] 0.52.1,
Bandit 1.9.4, pip-audit 2.10.1, pytest 9.1.1, pytest-asyncio 1.4.0, and
Pyright 1.1.411.

| Direct requirement | Baseline | Target and release date | Breaking changes, migration, and rationale |
| --- | --- | --- | --- |
| Alembic | 1.18.5 locked, 1.17.2 floor | 1.19.1 (2026-08-08) | Compatible v1 update. The reviewed revisions, `scripts/migrate.py`, and the temporary-database migration validator all pass. The floor was raised to the locked version, closing a drift left by an earlier lock-only bump. |
| pydantic-settings | 2.14.2 | 2.15.0 (2026-08-07) | Compatible v2 minor; settings schema regressions pass unchanged. |
| python-Levenshtein | 0.27.3 | 0.27.4 (2026-08-08) | Patch update; the bundled `Levenshtein` 0.27.4 and RapidFuzz surface used by player matching is unchanged. |
| pre-commit | 4.6.1 | 4.6.2 (2026-08-10) | Patch update; `pre-commit validate-config` passes against the refreshed hook revisions. |
| Ruff | 0.16.1 | 0.16.2 (2026-08-07) | Exact pin moved in `pyproject.toml` and `.pre-commit-config.yaml` together. Lint and format checks pass with no new findings and no source reformatting. |

### Transitive backend updates

The lock refresh also advanced these indirect packages. None required an
application change; the complete backend gate is the evidence.

| Package | Baseline | Target and release date | Notes |
| --- | --- | --- | --- |
| Starlette | 1.3.1 | 1.6.0 (2026-08-08) | Largest jump in this round. FastAPI 0.141.1 accepts it, and the authorization, routing, schema, rate-limit, and runtime-health tests pass against it. |
| Mako | 1.3.12 | 1.4.1 (2026-08-05) | Alembic template engine; revision generation and validation pass. |
| greenlet | 3.5.4 | 3.5.5 (2026-08-10) | SQLAlchemy async bridge patch. |
| cffi | 2.1.0 | 2.1.1 (2026-08-03) | Argon2 binding dependency patch. |
| packaging | 26.2 | 26.3 (2026-08-04) | Tooling metadata patch. |
| platformdirs | 4.11.0 | 4.11.2 (2026-08-10) | Tooling patch. |
| typing-inspection | 0.4.2 | 0.4.3 (2026-08-10) | Pydantic support library patch. |
| virtualenv | 21.7.1 | 21.7.4 (2026-08-10) | pre-commit environment builder patch. |
| cyclonedx-python-lib | 11.11.0 | 11.11.1 (2026-08-10) | pip-audit SBOM dependency patch. |
| pip | 26.2 | 26.2.1 (2026-08-04) | pip-audit resolution dependency patch. |

## Frontend direct dependencies

All target dates are npm publication dates. Every frontend direct requirement
not listed here was already at its latest stable release and is retained
unchanged, including Next.js 16.3.0, eslint-config-next 16.3.0, React and
React DOM 19.2.8, TypeScript 7.0.2 with the 6.0.2 API alias, Tailwind CSS and
`@tailwindcss/postcss` 4.3.3, TanStack Query 5.101.4, Axios 1.19.0, Zod 4.4.3,
Vitest 4.1.10, Playwright 1.62.1, jsdom 30.0.1, and every Radix UI package.

| Direct requirement | Baseline | Target and release date | Breaking changes, migration, and rationale |
| --- | --- | --- | --- |
| @marsidev/react-turnstile | 1.5.5 | 1.6.0 (2026-08-11) | Compatible v1 minor; the Turnstile widget integration and its existing transpilation are unchanged. |
| lucide-react | 1.30.0 | 1.31.0 (2026-08-09) | Compatible v1 minor; every named icon import used by the app still resolves and the production build passes. |
| react-hook-form | 7.84.0 | 7.85.0 (2026-08-08) | Compatible v7 minor; form types and resolver usage pass typecheck. |
| sonner | 2.0.7 | 2.0.8 (2026-08-09) | Patch update to the toast layer. |
| @types/node | 26.1.2 | 26.2.0 (2026-08-07) | Types minor aligned to Node 26; typecheck passes. |
| baseline-browser-mapping | 2.11.12 | 2.11.13 (2026-08-08) | Compatible v2 browser-data update. |
| ESLint | 10.8.0 | 10.8.1 (2026-08-07) | Patch update. The `@eslint/compat` adaptation for Next's legacy plugins remains required and unchanged; lint passes with `--max-warnings 0`. |

## Transitive security decisions

The two npm `overrides` that pin vulnerable transitive versions out of the tree
were re-reviewed and advanced to their current stable releases: PostCSS
8.5.25 to 8.5.26 (2026-08-06) and sharp 0.35.0 to 0.35.3 (2026-07-01). Both
remain necessary because the Next.js dependency chain still declares older
versions. The production build validates the sharp update.

npm 12's install-script inventory is unchanged. `unrs-resolver` still resolves
to the reviewed exact version 1.12.2 through `eslint-config-next`, and optional
macOS `fsevents` 2.3.3 is unchanged, so both `allowScripts` approvals stay
valid and `strict-allow-scripts=true` still rejects any new unreviewed
installer.

`npm audit` reports zero findings. `pip-audit` reports no known
vulnerabilities across the refreshed backend lock. No high or critical finding
is accepted or suppressed, and no prerelease was introduced by this refresh.

## Verification

The following ran on the refreshed tree and all passed:

- The complete `./test.sh` gate: 28 of 28 steps pass, including repository
  hygiene, ShellCheck, every contract regression, GitHub workflow syntax and
  security policy, Dependabot validation, frontend deterministic install, lint,
  typecheck, Vitest, and production build, then backend deterministic sync,
  237 backend tests on Python 3.14.7, Alembic migration validation against a
  live PostgreSQL 18.4 server, Ruff lint and format, Pyright, and Bandit.
- `./deploy/container-qa.sh`: the isolated stack builds all images from
  `docker/dockerfile:1.26` and `python:3.14.7-slim-bookworm`, the one-shot
  migration service completes, and the PostgreSQL, backend, and frontend
  services all report healthy before the disposable stack is removed.
- `pip-audit` and `npm audit`: no findings.

Local `uv` older than 0.12.3 cannot download the managed CPython 3.14.7 build
that `.python-version` now selects. A contributor on an older local `uv` must
update it, or install 3.14.7 once with a 0.12.3 or newer `uv`, before
`uv sync` will resolve the pinned interpreter.
