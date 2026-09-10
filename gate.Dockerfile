# Toolchain for ./test.sh. This image exists so the gate runs against one set
# of pinned tools locally and in CI, instead of a workflow reassembling them
# step by step on a runner. It is only a disposable test environment.
#
# Every pinned tool below is named by a `FROM`, never by `COPY --from=<image>`.
# Dependabot reads `FROM` lines only: this file's node pin has been bumped for
# us, while the four it reached solely through a COPY never once were.
FROM koalaman/shellcheck:v0.11.0 AS shellcheck
FROM rhysd/actionlint:1.7.12 AS actionlint
FROM zricethezav/gitleaks:v8.30.1 AS gitleaks
FROM ghcr.io/astral-sh/uv:0.12.7 AS uv

# Node comes from the base image, so .nvmrc is not consulted here. Keep the two
# in step when bumping Node.
FROM node:26.8.1-bookworm

# The base image bundles npm 11.19.0, which frontend/package.json rejects
# through devEngines. Install the pinned npm rather than relaxing that check.
RUN npm install --global npm@12.0.2 --ignore-scripts && npm --version

# PostgreSQL 18 clients. validate_migrations.py runs pg_dump, pg_restore and
# psql against the database over TCP and refuses any major version but 18.
# Debian bookworm ships 15, so the clients come from PGDG.
RUN set -eux; \
    apt-get update; \
    apt-get install --yes --no-install-recommends ca-certificates gnupg; \
    install -d -m 755 /usr/share/postgresql-common/pgdg; \
    curl --fail --silent --show-error --location \
      --output /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
      https://www.postgresql.org/media/keys/ACCC4CF8.asc; \
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list; \
    apt-get update; \
    apt-get install --yes --no-install-recommends postgresql-client-18; \
    rm -rf /var/lib/apt/lists/*; \
    pg_dump --version; \
    pg_restore --version; \
    psql --version

# Pinned linters, taken from their own release images rather than downloaded
# and checksummed by hand.
COPY --from=shellcheck /bin/shellcheck /usr/local/bin/shellcheck
COPY --from=actionlint /usr/local/bin/actionlint /usr/local/bin/actionlint
COPY --from=gitleaks /usr/bin/gitleaks /usr/local/bin/gitleaks

# uv resolves Python from .python-version. Local hooks use the same lockfile.
COPY --from=uv /uv /usr/local/bin/uv
ENV UV_PYTHON_INSTALL_DIR=/opt/uv-python \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=0
COPY .python-version /tmp/.python-version
RUN set -eux; \
    cd /tmp; \
    uv python install; \
    rm /tmp/.python-version; \
    chmod -R a+rX /opt/uv-python

# pre-commit, which the gate uses for the `repo: local` architecture rules in
# .pre-commit-config.yaml. It lives in its own environment rather than in
# backend/.venv so that the repository scope of the gate needs no backend sync,
# and so that nothing is installed while the gate runs. Keep the version in
# step with the one backend/pyproject.toml locks for .githooks/pre-commit.
RUN set -eux; \
    uv venv --python 3.14 /opt/pre-commit; \
    VIRTUAL_ENV=/opt/pre-commit uv pip install --no-cache pre-commit==4.6.2; \
    ln --symbolic /opt/pre-commit/bin/pre-commit /usr/local/bin/pre-commit; \
    chmod -R a+rX /opt/pre-commit; \
    pre-commit --version

# Chromium plus its system libraries, for the Playwright suite in frontend/e2e.
# The version must match the `@playwright/test` pin in frontend/package.json —
# Playwright refuses browsers built for another release, so a bump there needs
# the same bump here. It fails loudly rather than silently, at least.
#
# The download lands outside the repository because compose.gate.yml mounts an
# anonymous volume over frontend/node_modules, so anything installed under it
# at build time is hidden at run time.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
RUN set -eux; \
    npx --yes playwright@1.62.1 install --with-deps chromium; \
    rm -rf /var/lib/apt/lists/*; \
    chmod -R a+rX /opt/playwright

# npm and uv write here when the container runs as the invoking user rather
# than root. compose.gate.yml mounts persistent volumes at both cache paths so
# repeated runs do not re-download every package.
ENV NPM_CONFIG_CACHE=/tmp/npm-cache \
    UV_CACHE_DIR=/tmp/uv-cache \
    HOME=/tmp

# compose.gate.yml mounts an anonymous volume over each of these so no build
# output crosses the bind mount, and named volumes at the two cache paths.
# Docker seeds such a volume from the image, so the mode has to be set here;
# the container runs as whatever uid invoked it.
RUN install -d -m 777 \
      /workspace/frontend/.next \
      /workspace/frontend/node_modules \
      /workspace/backend/.venv \
      /tmp/npm-cache \
      /tmp/uv-cache

WORKDIR /workspace
ENTRYPOINT ["./test.sh"]
