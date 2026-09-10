# League Analysis

![Python](https://img.shields.io/badge/Python-3.14.7-3776AB?logo=python&logoColor=white)
![React](https://img.shields.io/badge/React-19.2.8-61DAFB?logo=react&logoColor=black)
![Next.js](https://img.shields.io/badge/Next.js-16.3.3-000000?logo=nextdotjs&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.141.1-009688?logo=fastapi&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-4169E1?logo=postgresql&logoColor=white)
![Status](https://img.shields.io/badge/Development-paused-orange)

**A closer look at your League of Legends games.**

League Analysis brings match history, ranked progress, and playing habits into
one place. Follow players, revisit past games, and explore how their performance
changes over time.

This is a personal portfolio project maintained by **Matěj Kadlec**.
Development is currently paused. The repository presents the work and lets
interested readers explore it on their own computer; ongoing support and new
features are not promised.

## What you can explore

- **Player overview:** recent results, favourite champions, roles, and ranked progress.
- **Match history:** browse past games and inspect each player's contribution.
- **Playstyle analysis:** explore patterns across a player's completed matches.
- **Matchmaking analysis:** compare teams using recorded match statistics and visible ranks.
- **Performance changes:** compare a player's recent games with their earlier games.
- **Player tracking:** keep selected players together and refresh their match information.

The experimental analysis describes patterns in recorded games. It does not
reveal Riot's hidden matchmaking rating or prove cheating, smurfing, boosting,
or who was playing an account.

## Try it on your computer

Setup currently requires a few command-line steps. You will need Linux or
Windows with WSL, Git, [Node.js](https://nodejs.org/) through NVM,
[uv](https://docs.astral.sh/uv/getting-started/installation/), and a running
[PostgreSQL 18](https://www.postgresql.org/download/) server. Install `lsof` and
`iproute2` as well; the launcher uses them to check local ports.

### 1. Download and install

```bash
git clone https://github.com/matejkadlec/league-analysis.git
cd league-analysis
nvm install
nvm use
npm install --global npm@12.0.2 --ignore-scripts
(cd frontend && npm ci)
(cd backend && uv sync --frozen --all-groups)
cp .env.example .env
chmod 600 .env
```

Python 3.14.7 and Node 26.8.1 are pinned in the repository. `uv` can install the
required Python version automatically.

### 2. Create your local database

Use a PostgreSQL server configured to listen only on localhost (the usual
Linux default). On a typical Linux/WSL PostgreSQL installation:

```bash
sudo -u postgres createuser --pwprompt league_analysis
sudo -u postgres createdb --owner=league_analysis league_analysis_local_dev
```

Use a randomly generated hexadecimal database password (letters a–f and digits)
to avoid reserved characters in the application's connection URL. Open `.env`, enter that password as
`POSTGRES_PASSWORD`, and replace `JWT_SECRET_KEY` with a new random value:

```bash
(cd backend && uv run python -c 'import secrets; print(secrets.token_hex(32))')
```

Keep `.env` private. Use a fresh local database, not someone else's database
export. No accounts, passwords, player database, or Riot API key are supplied.

### 3. Create your local administrator and start

```bash
(cd backend && uv run python scripts/migrate.py upgrade head)
(cd backend && uv run python scripts/reconcile_admin_account.py \
  --database league_analysis_local_dev \
  --email you@example.com --display-name "Your Name" --apply)
./run.sh
```

The administrator command asks for your chosen password without displaying it.
It is restricted to the named local development database. Open
**[localhost:3000](http://localhost:3000)** and sign in with that account.

The launcher stops anything already listening on ports 3000 and 8000. Use
`./run.sh 3001 8001` if those ports are occupied by another project. More setup
and troubleshooting details are in the [project guide](docs/project-overview.md).

### 4. Connect your own Riot API key

For private experimentation, obtain a development key from the
[Riot Developer Portal](https://developer.riotgames.com/), then save it in the
app's administrator **Settings** page. Development keys expire after 24 hours.
Without a valid key, live player lookup and match collection are unavailable;
a fresh database starts without match data.

Use your own credentials and follow Riot's registration and key-use rules.
Offering a running app to the public requires the appropriate Riot approval and
production key; a public GitHub repository does not provide that approval.
See [Riot's policies](https://developer.riotgames.com/policies/general) and the
[release notes](docs/public-release.md) before hosting a public service.

## For readers interested in the code

The interface uses React and Next.js. Python and FastAPI handle accounts,
analysis, and data collection, with PostgreSQL storing the results.

- [Architecture and development setup](docs/project-overview.md)
- [Riot API integration](docs/riot-api.md)
- [Quality checks](docs/quality-checks.md) — run `./test.sh` for the complete gate
- [Documentation index](docs/README.md)
- [Security reporting](SECURITY.md)

## License and Riot Games notice

Source is available for inspection under the existing
[All Rights Reserved license](LICENSE). Public visibility does not grant an
open-source license or permission to redistribute the code. Riot game data,
artwork, and trademarks remain subject to Riot's terms.

League Analysis isn't endorsed by Riot Games and doesn't reflect the views or
opinions of Riot Games or anyone officially involved in producing or managing
Riot Games properties. Riot Games, and all associated properties are trademarks
or registered trademarks of Riot Games, Inc.
