# syntax=docker/dockerfile:1
FROM golang:1.24.8-bookworm AS build
WORKDIR /src
# Official security release RELEASE.2025-10-15T17-29-55Z, pinned to its commit.
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export GIT_SSL_CAINFO=/run/secrets/proxy_ca; fi; \
    git init . && git remote add origin https://github.com/minio/minio.git && \
    git fetch --depth=1 origin 9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a && \
    git checkout --detach FETCH_HEAD
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export SSL_CERT_FILE=/run/secrets/proxy_ca; fi; \
    CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/minio .
COPY infra/minio/health.go /health.go
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/health /health.go && \
    mkdir -p /data /scratch-tmp && chown 1000:1000 /data && chmod 1777 /scratch-tmp

FROM scratch
COPY --from=build /out/minio /usr/local/bin/minio
COPY --from=build /out/health /usr/local/bin/health
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /src/LICENSE /LICENSE
COPY --from=build --chown=1000:1000 /data /data
COPY --from=build /scratch-tmp /tmp
ENV HOME=/tmp
USER 1000:1000
ENTRYPOINT ["/usr/local/bin/minio"]
