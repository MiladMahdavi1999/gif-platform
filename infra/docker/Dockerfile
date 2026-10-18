# syntax=docker/dockerfile:1
FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm install --global pnpm@10.34.7
COPY apps ./apps
COPY packages ./packages
COPY tsconfig.base.json ./
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    pnpm install --frozen-lockfile
RUN pnpm build

FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /app /app
COPY --chown=node:node scripts/provision-storage.mjs scripts/provision-storage.mjs
COPY --chown=node:node scripts/operations.mjs scripts/operations.mjs
COPY --chown=node:node scripts/staging-admin.mjs scripts/staging-admin.mjs
ARG SOURCE_REVISION
LABEL org.opencontainers.image.source="https://github.com/MiladMahdavi1999/gif-platform" \
      org.opencontainers.image.revision=$SOURCE_REVISION
USER node
CMD ["node", "apps/api/dist/main.js"]

FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS decoder-build
USER root
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export SSL_CERT_FILE=/run/secrets/proxy_ca; fi; \
    apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev && rm -rf /var/lib/apt/lists/*
COPY infra/decoder/sandbox.c /sandbox.c
RUN cc -shared -fPIC -O2 -Wall -Werror -o /sandbox.so /sandbox.c

FROM runtime AS worker
USER root
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export SSL_CERT_FILE=/run/secrets/proxy_ca; fi; \
    apt-get update && apt-get install -y --no-install-recommends ffmpeg=7:5.1.9-0+deb12u1 && rm -rf /var/lib/apt/lists/*
COPY --from=decoder-build /sandbox.so /app/infra/decoder/sandbox.so
USER node
CMD ["node", "apps/worker/dist/main.js"]

FROM runtime AS app
