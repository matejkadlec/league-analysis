# League Analysis

![Python](https://img.shields.io/badge/Python-3.13-20232a?style=for-the-badge&logo=python&logoColor=3776AB)
![FastAPI](https://img.shields.io/badge/FastAPI-0.118+-20232a?style=for-the-badge&logo=fastapi&logoColor=009688)
![React](https://img.shields.io/badge/React-19-20232a?style=for-the-badge&logo=react&logoColor=61DAFB)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18+-20232a?style=for-the-badge&logo=postgresql&logoColor=white)
![SQLAlchemy](https://img.shields.io/badge/SQLAlchemy-2.0+-20232a?style=for-the-badge&logo=sqlalchemy&logoColor=D71F00)

League of Legends web application for advanced player tracking, various statistics, playstyle and a
matchmaking analysis. Under active develoment.

## Quick Start

All commands below must be done from the project root folder in order to work.

### Backend Setup (Python)

```bash
# Navigate to backend directory
cd /backend

# Install uv (Python package manager)
curl -LsSf https://astral.sh/uv/install.sh | sh

# Create virtual environment and install dependencies
uv venv
source .venv/bin/activate
uv pip install -e .
```

### Frontend Setup (Node.js/React/Next.js)

```bash
# Navigate to frontend directory
cd /frontend

# Install Node.js dependencies
npm install
# or
pnpm install
# or
yarn install
```

### PostgreSQL 18 Setup

```bash
# Add PostgreSQL APT repository
sudo apt install -y postgresql-common
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh

# Install PostgreSQL 18
sudo apt update
sudo apt install -y postgresql-18 postgresql-contrib-18

# Start PostgreSQL service and enable start on boot
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Switch to postgres user and create database
sudo -u postgres psql -c "CREATE USER admin WITH PASSWORD 'your_password_here';"
sudo -u postgres psql -c "CREATE DATABASE \"league-analysis\" OWNER admin;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE \"league-analysis\" TO admin;"

# Initialize database schema
sudo -u postgres psql -d league-analysis -f backend/init_database.sql
```

### Environment Configuration

The `.env` file should be placed in the **project root**. You can ask another dev to send it to you
or setup it yourself:

```bash
cat > .env << 'EOF'
# Local DB config
POSTGRES_DB=league-analysis
POSTGRES_USER=admin
POSTGRES_PASSWORD=your_password_here
POSTGRES_HOST=localhost
POSTGRES_PORT=5432

# App config
LOG_LEVEL=INFO
JWT_SECRET_KEY=your-secret-key-here

# Next.js config
NEXT_PUBLIC_API_URL=http://localhost:8000
NODE_ENV=development

# CORS config
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000

# Riot API Key (optional fallback; API keys should be stored in DB)
RIOT_API_KEY=RGAPI-your-key-here

# API endpoints test parameters (optional)
REGION=EUROPE
PLATFORM=EUN1
GAME_NAME="John Doe"
TAG_LINE=EUNE
PUUID=your-puuid-here
MATCH_ID=EUN1_1234567890
EOF
```

### Run The Project

```bash
./run.sh
```

Logs are available at [backend.log](logs/backend.log) and [frontend.log](logs/frontend.log).

**Services**:

- Backend: http://localhost:8000 (API docs: `/redoc`)
- Frontend: http://localhost:3000

## Documentation

See [AGENTS.md](AGENTS.md) for main documentation index, individual folders then have their
specific `AGENTS.md` file. Though these file are primarily for AI agents, not for humans.

More readable documentation, as well as TODO tasks and Riot API response examples can be found
in the [docs](docs) folder, though it's incomplete and currently there are only 3 markdown files.

- `database.md`
- `jobs.md`
- `riot-api.md`

## Tech Stack

| Layer        | Technologies                                                |
| ------------ | ----------------------------------------------------------- |
| **Backend**  | Python 3.13, FastAPI, SQLAlchemy 2.0, PostgreSQL 18         |
| **Frontend** | Next.js 16, React 19, TypeScript, Tailwind CSS 4, shadcn/ui |
| **Data**     | TanStack Query, Zod, Axios                                  |

## License

**All Rights Reserved** © 2026 Matěj Kadlec.
