# syntax=docker/dockerfile:1.18
FROM ghcr.io/astral-sh/uv:0.12.3 AS uv

FROM python:3.15.0rc1-slim-bookworm AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

RUN apt-get update \
    && apt-get install --yes --no-install-recommends build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY --from=uv /uv /uvx /bin/

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY alembic.ini ./alembic.ini
COPY alembic ./alembic
COPY app ./app
COPY scripts/migrate.py ./scripts/migrate.py
RUN uv sync --frozen --no-dev

FROM python:3.15.0rc1-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/app/.venv/bin:$PATH \
    PYTHONPATH=/app

RUN apt-get update \
    && apt-get install --yes --no-install-recommends libpq5 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 league-analysis \
    && useradd --system --uid 10001 --gid league-analysis \
      --home-dir /app --shell /usr/sbin/nologin league-analysis

WORKDIR /app
COPY --from=builder --chown=league-analysis:league-analysis /app/.venv /app/.venv
COPY --from=builder --chown=league-analysis:league-analysis /app/alembic.ini ./alembic.ini
COPY --from=builder --chown=league-analysis:league-analysis /app/alembic ./alembic
COPY --from=builder --chown=league-analysis:league-analysis /app/app ./app
COPY --from=builder --chown=league-analysis:league-analysis /app/scripts/migrate.py ./scripts/migrate.py

USER league-analysis:league-analysis
EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-proxy-headers"]
