# syntax=docker/dockerfile:1.26
FROM node:26.7.0-bookworm-slim AS dependencies

ENV NEXT_TELEMETRY_DISABLED=1 \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false

WORKDIR /app
RUN npm install --global npm@12.0.2 --ignore-scripts
COPY package.json package-lock.json .npmrc ./
RUN npm ci

FROM dependencies AS builder

ARG API_INTERNAL_URL=http://backend:8000
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_ALLOW_INDEXING=false
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=
ARG NEXT_DEPLOYMENT_ID
ENV API_INTERNAL_URL=$API_INTERNAL_URL \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_ALLOW_INDEXING=$NEXT_PUBLIC_ALLOW_INDEXING \
    NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY \
    NEXT_DEPLOYMENT_ID=$NEXT_DEPLOYMENT_ID

COPY . .
# Public URLs empty at build ship a site that points nowhere. The deployment
# id empty at build ships a site that cannot tell an old tab from a new
# image, so a client navigation after deploy asks for chunks the origin
# deleted. Say which is missing rather than exiting 1.
RUN set -eu; \
    : "${NEXT_PUBLIC_API_URL:?must be passed as a build arg}"; \
    : "${NEXT_PUBLIC_SITE_URL:?must be passed as a build arg}"; \
    : "${NEXT_DEPLOYMENT_ID:?must be passed as a build arg}"; \
    npm run build

FROM node:26.7.0-bookworm-slim AS runtime

ARG NEXT_DEPLOYMENT_ID
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    NEXT_DEPLOYMENT_ID=$NEXT_DEPLOYMENT_ID

RUN groupadd --system --gid 10001 league-analysis \
    && useradd --system --uid 10001 --gid league-analysis \
      --home-dir /app --shell /usr/sbin/nologin league-analysis \
    && rm -rf /usr/local/lib/node_modules/npm \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx

WORKDIR /app
COPY --from=builder --chown=league-analysis:league-analysis /app/public ./public
COPY --from=builder --chown=league-analysis:league-analysis /app/.next/standalone ./
COPY --from=builder --chown=league-analysis:league-analysis /app/.next/static ./.next/static

USER league-analysis:league-analysis
EXPOSE 3000

CMD ["node", "server.js"]
