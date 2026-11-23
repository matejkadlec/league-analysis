# Production image of the API: the locked dependencies, the application and its
# Alembic revisions, run by an unprivileged user.
#
# Every base image is pinned by tag and digest; change the two together. Keep
# the Python version in step with .python-version and the uv version with
# gate.Dockerfile (tools/check-toolchain-pins.sh compares them).
FROM ghcr.io/astral-sh/uv:0.13.9@sha256:d3b601f0c7b118bc1753febf7c41cc80981df678445e0254284eecf84db79a7d AS uv

FROM python:3.15.0-slim-bookworm@sha256:0e019bbdfb5d9874cb2389f1c2884b64aa2ac97c99960b5bc521cef978c0617d AS base

FROM base AS builder

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

FROM base AS runtime

# FORWARDED_ALLOW_IPS is what `--proxy-headers` trusts. Loopback only here, so
# an image run on its own believes no forwarded address; compose.production.yml
# names the internal networks the frontend and the tunnel connector sit on.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/app/.venv/bin:$PATH \
    PYTHONPATH=/app \
    FORWARDED_ALLOW_IPS=127.0.0.1

RUN groupadd --system --gid 10001 league-analysis \
    && useradd --system --uid 10001 --gid league-analysis \
      --home-dir /app --shell /usr/sbin/nologin league-analysis

WORKDIR /app
COPY --from=builder --chown=league-analysis:league-analysis /app/.venv /app/.venv
# One COPY per source: a multi-source COPY into a directory copies each
# source's contents and would flatten `alembic/` and `app/` into /app.
COPY --chown=league-analysis:league-analysis alembic.ini ./alembic.ini
COPY --chown=league-analysis:league-analysis alembic ./alembic
COPY --chown=league-analysis:league-analysis app ./app
COPY --chown=league-analysis:league-analysis scripts/migrate.py scripts/account.py ./scripts/

USER league-analysis:league-analysis
EXPOSE 8000

# Exactly one worker: the scheduler and the job runtime live in this process,
# so a second worker would be a second job runner. The graceful-shutdown bound
# keeps a stop inside the container's stop_grace_period even while a client
# holds a connection open.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--proxy-headers", "--timeout-graceful-shutdown", "20"]
