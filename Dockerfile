# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS build
WORKDIR /app

# Copy workspace manifests first for dependency caching.
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/collab/package.json apps/collab/package.json
COPY packages/core/package.json packages/core/package.json

RUN npm ci

COPY . .

# Build static web assets.
RUN npm run -w @archival/web build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends nginx apache2-utils gettext-base \
    && rm -rf /var/lib/apt/lists/* \
    && rm -f /etc/nginx/sites-enabled/default

# Keep full workspace to run the collab server and serve built web assets.
COPY --from=build /app /app

# Runtime proxy/bootstrap scripts.
COPY deploy/cloud-run/nginx.conf.template /app/deploy/cloud-run/nginx.conf.template
COPY deploy/cloud-run/entrypoint.sh /app/deploy/cloud-run/entrypoint.sh
RUN chmod +x /app/deploy/cloud-run/entrypoint.sh

ENV NODE_ENV=production
ENV PORT=8080
ENV HOCUSPOCUS_HOST=127.0.0.1
ENV HOCUSPOCUS_PORT=1234

EXPOSE 8080

ENTRYPOINT ["/app/deploy/cloud-run/entrypoint.sh"]
