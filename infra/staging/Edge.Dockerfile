FROM caddy:2.10.2-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d
# High-port staging ingress needs no bind capability. Strip the base file cap so
# exec remains valid with cap_drop=ALL and no-new-privileges.
RUN setcap -r /usr/bin/caddy
COPY infra/staging/Caddyfile /etc/caddy/Caddyfile
ARG SOURCE_REVISION
LABEL org.opencontainers.image.source="https://github.com/MiladMahdavi1999/gif-platform" \
      org.opencontainers.image.revision=$SOURCE_REVISION
USER 1000:1000
