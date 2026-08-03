# Runtime and Dependency Upgrade Review (2026-08-03)

> **Authority:** Dated LGA-9 inventory and target-selection record. The live
> manifests and lockfiles remain authoritative after this review.

## Method and selection rules

The baseline is the version resolved by `origin/master` before LGA-9, not only
the lower bound written in a manifest. Target versions and publication dates
were queried from the official npm registry and PyPI on 2026-08-03. Runtime,
database, action, and tool decisions were cross-checked against their official
release pages.

Only stable versions were selected. ESLint 10 remains outside several
`eslint-config-next` plugin peer ranges, so the flat config applies
`@eslint/compat` to adapt their legacy rule APIs without disabling rules.
TypeScript 7 does not yet expose the compiler API expected by
`typescript-eslint`, so the frontend runs the native TypeScript 7 compiler
through `@typescript/native` while the `typescript` alias supplies the
supported TypeScript 6 API to lint tooling. The unused
`eslint-plugin-react-compiler` RC was removed.

Primary release sources include [Python 3.14.6], [Node.js 26.5.1], the
[Node.js release schedule], [TypeScript 7.0], [Next.js 16.2], [PostgreSQL
18.4], [PyPI], [npm], and the linked GitHub releases in the tooling matrix.

[Python 3.14.6]: https://www.python.org/downloads/release/python-3146/
[Node.js 26.5.1]: https://nodejs.org/en/blog/release/v26.5.1
[Node.js release schedule]: https://nodejs.org/en/about/previous-releases
[TypeScript 7.0]: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
[Next.js 16.2]: https://nextjs.org/blog/next-16-2
[PostgreSQL 18.4]: https://www.postgresql.org/docs/current/release-18-4.html
[PyPI]: https://pypi.org/
[npm]: https://www.npmjs.com/

## Runtimes, package managers, CI, and repository tools

| Component | Baseline | Selected target and release date | Breaking changes, migration, and rationale |
| --- | --- | --- | --- |
| Python | 3.14.6 | 3.14.6 (2026-06-10) | Retained: latest stable 3.14 maintenance release; no 3.15 prerelease. `requires-python` now starts at the exact supported patch. |
| Node.js | 20.19.6 | 26.5.1 (2026-07-29) | Major runtime jump; Node 20 is EOL. Node 26 changes V8 and removes deprecated APIs, so exact selection, lint, typecheck, tests, and production build are required. |
| npm | 11.7.0 | 12.0.2 (2026-07-29) | Major CLI update. `packageManager`, `devEngines`, CI installation, engine enforcement, and reviewed install-script approvals make the package-manager boundary explicit. |
| uv | 0.11.28 observed locally; unpinned in CI | 0.12.1 (2026-07-31) | Pre-1.0 minor may contain breaking behavior. CI now pins the exact version; the existing uv workflow and lock format remain valid. |
| PostgreSQL CI service | floating `postgres:18` | `postgres:18.4` (2026-05-14) | Same major; no dump/restore migration. Exact minor includes security and correctness fixes and prevents an unreviewed floating update. |
| `actions/checkout` | 7.0.1 | 7.0.1 (2026-07-20) | Retained latest stable immutable commit pin. |
| `actions/setup-node` | 7.0.0 | 7.0.0 (2026-07-14) | Retained latest stable immutable commit pin. |
| [`astral-sh/setup-uv`] | 8.3.2 | 9.0.0 (2026-07-21) | Major action update; `prune-cache` defaults changed. The workflow does not depend on pruning and now pins uv 0.12.1 explicitly. |
| `pre-commit-hooks` | 6.0.0 | 6.0.0 (2025-08-09) | Retained latest stable hook release. |
| `ruff-pre-commit` | 0.16.1 | 0.16.1 (2026-07-30) | Retained and kept equal to the backend Ruff pin. |
| [`ShellCheck`] | 0.10.0 | 0.11.0 (2025-08-04) | Stable tool update. Both supported Linux archive and extracted-binary hashes were re-derived and pinned; the full shell corpus passes. |
| [`actionlint`] | 1.7.12 | 1.7.12 (2026-03-30) | Retained latest stable checksum-verified release. |
| Docker application images | none | none | No Dockerfile or Compose deployment artifact exists. LGA-10 owns their introduction and must use these runtime targets. |
| Dependabot configuration | none | none | No configuration exists. LGA-15 owns its introduction after this lockfile baseline. |

[`astral-sh/setup-uv`]: https://github.com/astral-sh/setup-uv/releases/tag/v9.0.0
[`ShellCheck`]: https://github.com/koalaman/shellcheck/releases/tag/v0.11.0
[`actionlint`]: https://github.com/rhysd/actionlint/releases/tag/v1.7.12

## Backend direct dependencies

All target dates are PyPI publication dates. A “compatible update” required no
application migration beyond lock refresh and the backend gate; any observed
breakage would have blocked the target.

| Direct requirement | Baseline | Target and release date | Breaking changes, migration, and rationale |
| --- | --- | --- | --- |
| APScheduler | 3.11.2 | 3.11.3 (2026-06-28) | Patch update; scheduler tests cover application usage. |
| asyncpg | 0.31.0 | 0.31.0 (2025-11-24) | Retained latest stable. |
| email-validator | 2.3.0 | 2.3.0 (2025-08-26) | Retained latest stable. |
| FastAPI | 0.128.8 | 0.141.1 (2026-07-29) | Compatible pre-1.0 update; authorization, schema, and route tests pass against Starlette 1.3.1. |
| httpx | 0.28.1 | 0.28.1 (2024-12-06) | Retained latest stable; Riot HTTP boundary tests pass. |
| passlib[argon2] | 1.7.4 | 1.7.4 (2020-10-08) | No newer stable release. Retained because the application uses its Argon2 backend; audit found no known vulnerability. Maintenance age remains a future replacement consideration. |
| psycopg2-binary | 2.9.11 | 2.9.12 (2026-04-21) | Patch update; APScheduler database integration surface is unchanged. |
| Pydantic | 2.12.5 | 2.13.4 (2026-05-06) | Compatible v2 update; schema regressions pass. |
| pydantic-settings | 2.12.0 | 2.14.2 (2026-06-19) | Compatible v2 update; settings tests pass. |
| python-dotenv | 1.2.1 | 1.2.2 (2026-03-01) | Patch update; environment loading contract unchanged. |
| PyJWT[crypto] | 2.11.0 | 2.13.0 (2026-05-21) | Compatible v2 security/auth update; token tests pass with cryptography 50.0.0. |
| python-Levenshtein | 0.27.3 | 0.27.3 (2025-11-01) | Retained latest stable. |
| python-multipart | 0.0.22 | 0.0.32 (2026-06-04) | Compatible pre-1.0 update; authentication form parsing tests pass. |
| slowapi | 0.1.9 | 0.1.10 (2026-06-13) | Compatible pre-1.0 update; existing Python 3.14 deprecation filter remains required. |
| SQLAlchemy | 2.0.46 | 2.0.51 (2026-06-15) | Patch update within SQLAlchemy 2; tests and Pyright pass. |
| structlog | 25.5.0 | 26.1.0 (2026-06-06) | Major calendar-version update; the application uses stable `get_logger`/event APIs and the complete backend gate passes. |
| uvicorn[standard] | 0.40.0 | 0.52.1 (2026-08-01) | Compatible pre-1.0 update; `run.sh` startup and API smoke checks validate the server boundary. |
| Bandit | 1.9.4 | 1.9.4 (2026-02-25) | Retained latest stable security scanner. |
| pip-audit | 2.10.1 | 2.10.1 (2026-06-10) | Retained latest stable audit client. |
| pre-commit | 4.6.1 | 4.6.1 (2026-07-21) | Retained latest stable. |
| pytest | 9.1.1 | 9.1.1 (2026-06-19) | Lock already current; manifest floor now records the tested major. |
| pytest-asyncio | 1.4.0 | 1.4.0 (2026-05-26) | Lock already current; manifest floor now records the tested release. |
| Pyright | 1.1.408 | 1.1.411 (2026-06-25) | Patch update; zero errors and warnings. |
| Ruff | 0.16.1 | 0.16.1 (2026-07-30) | Retained exact stable pin for deterministic lint/format behavior. |

## Frontend direct production dependencies

| Direct requirement | Baseline | Target and release date | Breaking changes, migration, and rationale |
| --- | --- | --- | --- |
| @hookform/resolvers | 5.2.2 | 5.7.1 (2026-08-02) | Compatible v5 update; forms typecheck and build. |
| @marsidev/react-turnstile | 1.4.2 | 1.5.4 (2026-07-27) | Compatible v1 update; existing transpilation remains. |
| @radix-ui/react-dialog | 1.1.15 | 1.1.23 (2026-07-24) | Compatible patch update. |
| @radix-ui/react-icons | 1.3.2 | 1.3.2 (2024-11-14) | Retained latest stable. |
| @radix-ui/react-label | 2.1.8 | 2.1.15 (2026-07-24) | Compatible patch update. |
| @radix-ui/react-popover | 1.1.15 | 1.1.23 (2026-07-24) | Compatible patch update. |
| @radix-ui/react-progress | 1.1.8 | 1.1.16 (2026-07-24) | Compatible patch update. |
| @radix-ui/react-select | 2.2.6 | 2.3.7 (2026-07-24) | Compatible v2 update; frontend gate validates component use. |
| @radix-ui/react-separator | 1.1.8 | 1.1.15 (2026-07-24) | Compatible patch update. |
| @radix-ui/react-slot | 1.2.4 | 1.3.3 (2026-07-24) | Compatible v1 update. |
| @radix-ui/react-tabs | 1.1.13 | 1.1.21 (2026-07-24) | Compatible patch update. |
| @radix-ui/react-tooltip | 1.2.8 | 1.2.16 (2026-07-24) | Compatible patch update. |
| @tanstack/react-query | 5.90.21 | 5.101.4 (2026-07-21) | Compatible v5 update; query APIs unchanged. |
| axios | 1.13.5 | 1.19.0 (2026-07-29) | Security update within v1; clears direct Axios advisories. |
| class-variance-authority | 0.7.1 | 0.7.1 (2024-11-26) | Retained latest stable. |
| clsx | 2.1.1 | 2.1.1 (2024-04-23) | Retained latest stable. |
| cmdk | 1.1.1 | 1.1.1 (2025-03-14) | Retained latest stable. |
| cronstrue | 3.12.0 | 3.24.0 (2026-06-29) | Compatible v3 update; jobs UI compiles. |
| lucide-react | 0.563.0 | 1.28.0 (2026-07-30) | Major stable release; named icon imports used by the app remain valid and the production build passes. |
| Next.js | 16.1.6 | 16.2.12 (2026-07-25) | Minor framework update plus security patches. New lint findings were reviewed; justified hydration-initialization effects are narrowly suppressed and a stale suppression was removed. |
| next-themes | 0.4.6 | 0.4.6 (2025-03-11) | Retained latest stable. |
| React | 19.2.4 | 19.2.8 (2026-07-21) | Patch update; no component migration. |
| React DOM | 19.2.4 | 19.2.8 (2026-07-21) | Kept exactly aligned with React. |
| react-hook-form | 7.71.1 | 7.84.0 (2026-08-01) | Compatible v7 update; form types pass. |
| sonner | 2.0.7 | 2.0.7 (2025-08-02) | Retained latest stable. |
| tailwind-merge | 3.4.0 | 3.6.0 (2026-05-10) | Compatible v3 update. |
| Zod | 4.3.6 | 4.4.3 (2026-05-04) | Compatible v4 update; validation tests pass. |

## Frontend direct development dependencies

| Direct requirement | Baseline | Target and release date | Breaking changes, migration, and rationale |
| --- | --- | --- | --- |
| @tailwindcss/postcss | 4.1.18 | 4.3.3 (2026-07-16) | Compatible v4 update, kept aligned with Tailwind CSS. |
| @types/node | 25.2.3 | 26.1.2 (2026-07-27) | Major types update aligned to Node 26; typecheck passes. |
| @types/react | 19.2.14 | 19.2.18 (2026-07-30) | Patch update aligned with React 19. |
| @types/react-dom | 19.2.3 | 19.2.4 (2026-07-30) | Patch update aligned with React DOM 19. |
| baseline-browser-mapping | 2.9.19 | 2.11.11 (2026-08-02) | Compatible v2 data update. |
| ESLint | 9.39.2 | 10.8.0 (2026-08-02) | Stable major update. `@eslint/compat` adapts the removed rule-context APIs used by Next's nested import, JSX a11y, and React plugins while retaining every configured lint rule. |
| eslint-config-next | 16.1.6 | 16.2.12 (2026-07-25) | Kept exactly aligned with Next.js. |
| eslint-plugin-react-compiler | 19.1.0-rc.2 | removed | Unused and the registry exposes only RC/experimental releases; removal eliminates an unintended direct prerelease. |
| eslint-plugin-react-hooks | 7.0.1 | 7.1.1 (2026-04-17) | Compatible v7 update; new effect diagnostics were resolved or narrowly justified. |
| Tailwind CSS | 4.1.18 | 4.3.3 (2026-07-16) | Compatible v4 update; production styles build. |
| tailwindcss-animate | 1.0.7 | 1.0.7 (2023-08-28) | Retained latest stable. |
| TypeScript | 5.9.3 | 7.0.2 native compiler plus 6.0.2 API compatibility (2026-07-08) | TypeScript 7 does not ship a compiler API. `@typescript/native` provides the `tsc` executable while the `typescript` npm alias resolves `@typescript/typescript6` for `typescript-eslint`; lint and typecheck both pass. |
| Vitest | 3.2.7 | 4.1.10 (2026-07-06) | Major runner update; all deterministic tests pass without configuration migration. |

## Transitive security decisions

The initial baseline reported 13 npm findings, including high-severity direct
Axios and Next.js-chain findings. Updating direct packages removed the Axios
and framework-version findings. Next.js 16.2.12 still declared vulnerable
transitive PostCSS 8.4.31 and sharp 0.34.5 versions, so npm `overrides` select
PostCSS 8.5.25 (2026-07-29) and sharp 0.35.0 (2026-06-10). The sharp major
requires Node 20.9 or newer and removes deprecated image APIs that Next does
not use; the production build validates compatibility. The final `npm audit`
reports zero findings.

The refreshed Python lock selects stable releases only and `pip-audit` reports
no known vulnerabilities. No high or critical finding is accepted or
suppressed. The only prerelease string in either final lock is the inherited
`gensync` 1.0.0-beta.2 package used by Babel; it was already present on
`origin/master`, has no stable registry release, and was not introduced or
selected directly by LGA-9.

npm 12's install-script inventory identified two reviewed packages. The exact
`unrs-resolver` 1.12.2 postinstall prepares its platform binding, and optional
macOS `fsevents` 2.3.3 runs its published `node-gyp rebuild`. Both exact
versions are approved in `allowScripts`; `strict-allow-scripts=true` rejects
any new unreviewed installer.

Security references: [PostCSS source-map advisories], [sharp/libvips advisory],
[npm install-script approvals], and [sharp 0.35.0 changes].

[PostCSS source-map advisories]: https://github.com/advisories/GHSA-r28c-9q8g-f849
[sharp/libvips advisory]: https://github.com/advisories/GHSA-f88m-g3jw-g9cj
[npm install-script approvals]: https://docs.npmjs.com/cli/v11/commands/npm-approve-scripts/
[sharp 0.35.0 changes]: https://sharp.pixelplumbing.com/changelog/v0.35.0/

## Verification and deferred integrations

The required deterministic evidence is `npm ci`, `npm audit`, `pip-audit`, the
frontend lint/typecheck/Vitest/build sequence, backend tests/static analysis,
`./run.sh` startup, API/frontend smoke requests, and the complete `./test.sh`
gate. Exact results belong in the pull request handoff because they validate a
specific commit.

No Codex Cloud Setup or Maintenance script exists in the repository or was
supplied with LGA-9. `./test.sh` requires no Cloud environment variables or
secrets: it injects deterministic test-only backend values and its tests are
network-free. An optional Cloud application smoke run has these boundaries:

| Variable | Classification and value policy |
| --- | --- |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_HOST`, `POSTGRES_PORT` | Required non-secret connection metadata; safe values may identify a disposable Cloud test database. |
| `POSTGRES_PASSWORD` | Required for application startup. A disposable test-only value may be a non-secret default; any shared or durable database password is a secret configured in the UI. |
| `DEBUG`, `ENVIRONMENT` | Safe non-secret defaults: `false` and `test` for the quality workflow. Use `dev` for a `run.sh` smoke because the application currently recognizes only `dev`/`production` runtime modes. |
| `JWT_SECRET_KEY` | Required for an application smoke. A fixed test-only value of at least 32 characters is safe only for an isolated disposable environment; every real runtime value is a UI-managed secret. |
| `RIOT_API_KEY` | Not required by the quality gate or basic HTTP smoke. It is a secret required only for live Riot calls. |
| `TURNSTILE_SECRET_KEY`, `SMTP_PASSWORD` | Optional runtime secrets, needed only when those integrations are exercised. Other SMTP host/port/user/from/TLS settings are non-secret metadata. |
| `LGA_VALIDATE_MIGRATIONS` | Safe non-secret value `1` once LGA-12 adds Alembic; currently ignored because no Alembic configuration exists. |

Secret values must never be copied into Jira, source, or chat. Once the owner
supplies the current Cloud scripts, they should install Python 3.14.6,
Node 26.5.1, npm 12.0.2, and uv 0.12.1, then invoke `./test.sh`.
