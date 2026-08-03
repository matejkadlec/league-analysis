# League Analysis

![Python](https://img.shields.io/badge/Python-3.14.6-20232a?style=for-the-badge&logo=python&logoColor=3776AB)
![FastAPI](https://img.shields.io/badge/FastAPI-0.141+-20232a?style=for-the-badge&logo=fastapi&logoColor=009688)
![React](https://img.shields.io/badge/React-19-20232a?style=for-the-badge&logo=react&logoColor=61DAFB)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18+-20232a?style=for-the-badge&logo=postgresql&logoColor=white)
![Status](https://img.shields.io/badge/status-inactive-red?style=for-the-badge)
[![Quality Checks](https://github.com/matejkadlec/league-analysis/actions/workflows/quality-checks.yml/badge.svg)](https://github.com/matejkadlec/league-analysis/actions/workflows/quality-checks.yml)

League Analysis is a full-stack League of Legends analytics platform prototype that combines tracked-player monitoring, match history processing, playstyle signals, and matchmaking-quality analysis in one app.

This repository is public as a portfolio snapshot. Active development in this repository is currently paused.

Engineering architecture, workflows, integrations, schema guidance, and local
commands are indexed in [`docs/README.md`](docs/README.md).

## Product Highlights

- Tracked players dashboard with aggregated match history and rank trends
- Matchmaking analysis workflow with transparent scoring and history comparisons
- Profile-level analysis for recent performance, champion patterns, and role tendencies
- Background job orchestration for periodic data refresh from Riot APIs

## Tech Stack

| Layer        | Technologies                                                     |
| ------------ | ---------------------------------------------------------------- |
| **Backend**  | Python, FastAPI, SQLAlchemy, PostgreSQL                          |
| **Frontend** | Next.js (App Router), React, TypeScript, Tailwind CSS, shadcn/ui |
| **Data**     | TanStack Query, Zod, Axios                                       |
| **External** | Riot Games API                                                   |

## Riot API Notes

- Riot API keys are intentionally excluded from the repository.
- Required Riot legal boilerplate is present in the product legal page (`frontend/app/license/page.tsx`).
- Public source code visibility is allowed, but any running public product must use the correct Riot key type and follow Riot policy updates.

## Development and Quality

The supported local environment uses the runtime pins in `.nvmrc` and
`.python-version`, npm for the frontend, and uv for the backend. After selecting
Node 26.5.1, install the pinned npm with
`npm install --global npm@12.0.2 --ignore-scripts`.

```bash
./run.sh             # Start the local application
(cd backend && uv run python scripts/migrate.py upgrade head)  # Apply reviewed schema revisions
./test.sh -f         # Repository and frontend checks
./test.sh -b         # Repository and backend checks
./test.sh            # Complete pre-pull-request quality gate
```

The complete gate performs deterministic installs, linting, type checks,
backend and frontend regression tests, a production frontend build, static
security analysis, ShellCheck, and GitHub workflow validation. GitHub Actions
runs the same gate and a separate live production dependency audit. No ordinary
quality check requires a real Riot API key.

## Repository Policy

- No external development contributions are accepted.
- Unsolicited external pull requests are not reviewed or merged.
- No code/data sharing rights are granted outside explicit written permission.

## Disable PRs Without Archiving

1. Open repository `Settings`.
2. Under `General` -> `Features`, disable `Pull requests`.
3. Optional: disable `Issues` and `Discussions` in the same `Features` section.
4. Optional: disable `Actions` in `Settings` -> `Actions` -> `General`.

## License

**All Rights Reserved** © 2026 League Analysis.
