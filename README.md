# League Analysis

![Python](https://img.shields.io/badge/Python-3.13-20232a?style=for-the-badge&logo=python&logoColor=3776AB)
![FastAPI](https://img.shields.io/badge/FastAPI-0.118+-20232a?style=for-the-badge&logo=fastapi&logoColor=009688)
![React](https://img.shields.io/badge/React-19-20232a?style=for-the-badge&logo=react&logoColor=61DAFB)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18+-20232a?style=for-the-badge&logo=postgresql&logoColor=white)
![SQLAlchemy](https://img.shields.io/badge/SQLAlchemy-2.0+-20232a?style=for-the-badge&logo=sqlalchemy&logoColor=D71F00)

League of Legends player tracking, playstyle analysis, and matchmaking fairness tool.

## Quick Start

```bash
# Configure environment
cp .env.example .env
# Edit .env with your Riot API key and database credentials

# Start services
./run.sh

# View logs
tail -f logs/backend.log
tail -f logs/frontend.log
```

**Services**:

- Backend: http://localhost:8000 (Swagger: `/api`)
- Frontend: http://localhost:3000

## Documentation

See [AGENTS.md](AGENTS.md) for complete documentation index including:

- Database schema
- Riot API integration
- Background jobs
- Architecture guides

## Tech Stack

| Layer        | Technologies                                                |
| ------------ | ----------------------------------------------------------- |
| **Backend**  | Python 3.13, FastAPI, SQLAlchemy 2.0, PostgreSQL 18         |
| **Frontend** | Next.js 16, React 19, TypeScript, Tailwind CSS 4, shadcn/ui |
| **Data**     | TanStack Query, Zod, Axios                                  |

## License

**All Rights Reserved** © 2025 Matěj Kadlec.
