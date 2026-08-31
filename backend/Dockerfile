# syntax=docker/dockerfile:1.26
FROM ghcr.io/astral-sh/uv:0.12.7 AS uv

FROM python:3.14.7-slim-bookworm AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

# No compiler and no libpq headers: every locked dependency resolves to a
# wheel for this interpreter and platform, and the one Postgres driver that
# wants libpq is `psycopg2-binary`, which bundles its own.
COPY --from=uv /uv /uvx /bin/

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

FROM python:3.14.7-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/app/.venv/bin:$PATH \
    PYTHONPATH=/app

RUN groupadd --system --gid 10001 league-analysis \
    && useradd --system --uid 10001 --gid league-analysis \
      --home-dir /app --shell /usr/sbin/nologin league-analysis

WORKDIR /app
COPY --from=builder --chown=league-analysis:league-analysis /app/.venv /app/.venv
# From the build context, not the builder: the builder only ever held these to
# feed a second `uv sync` whose only product was a .pth entry that PYTHONPATH
# already supersedes. Four COPY lines rather than one, because a multi-source
# COPY into a directory copies each source's *contents* and would flatten
# `alembic/` and `app/` into /app.
COPY --chown=league-analysis:league-analysis alembic.ini ./alembic.ini
COPY --chown=league-analysis:league-analysis alembic ./alembic
COPY --chown=league-analysis:league-analysis app ./app
COPY --chown=league-analysis:league-analysis scripts/migrate.py ./scripts/migrate.py

USER league-analysis:league-analysis
EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-proxy-headers"]
