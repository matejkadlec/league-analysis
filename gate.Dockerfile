# Toolchain for ./test.sh. This image exists so the gate runs against one set
# of pinned tools locally and in CI, instead of a workflow reassembling them
# step by step on a runner. It is never deployed; production images are
# backend/Dockerfile and frontend/Dockerfile.
#
# Node comes from the base image, so .nvmrc is not consulted here. Keep the two
# in step when bumping Node.
FROM node:26.7.0-bookworm

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
COPY --from=koalaman/shellcheck:v0.11.0 /bin/shellcheck /usr/local/bin/shellcheck
COPY --from=rhysd/actionlint:1.7.12 /usr/local/bin/actionlint /usr/local/bin/actionlint

# uv, and the Python it resolves from .python-version.
COPY --from=ghcr.io/astral-sh/uv:0.12.3 /uv /usr/local/bin/uv
ENV UV_PYTHON_INSTALL_DIR=/opt/uv-python \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=0
COPY .python-version /tmp/.python-version
RUN set -eux; \
    cd /tmp; \
    uv python install; \
    rm /tmp/.python-version; \
    chmod -R a+rX /opt/uv-python

# npm writes here when the container runs as the invoking user rather than root.
ENV NPM_CONFIG_CACHE=/tmp/npm-cache \
    HOME=/tmp

WORKDIR /workspace
ENTRYPOINT ["./test.sh"]
