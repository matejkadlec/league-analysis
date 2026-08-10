# syntax=docker/dockerfile:1.18
FROM node:26.5.1-bookworm-slim AS dependencies

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
ENV API_INTERNAL_URL=$API_INTERNAL_URL \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_ALLOW_INDEXING=$NEXT_PUBLIC_ALLOW_INDEXING \
    NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY

COPY . .
RUN test -n "$NEXT_PUBLIC_API_URL" \
    && test -n "$NEXT_PUBLIC_SITE_URL" \
    && npm run build

FROM node:26.5.1-bookworm-slim AS runtime

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

RUN groupadd --system --gid 10001 league-analysis \
    && useradd --system --uid 10001 --gid league-analysis \
      --home-dir /app --shell /usr/sbin/nologin league-analysis \
    && rm -rf /usr/local/lib/node_modules/npm /opt/yarn-v* \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg

WORKDIR /app
COPY --from=builder --chown=league-analysis:league-analysis /app/public ./public
COPY --from=builder --chown=league-analysis:league-analysis /app/.next/standalone ./
COPY --from=builder --chown=league-analysis:league-analysis /app/.next/static ./.next/static

USER league-analysis:league-analysis
EXPOSE 3000

CMD ["node", "server.js"]
