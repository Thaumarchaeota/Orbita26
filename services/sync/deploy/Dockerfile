FROM rust:latest AS builder
WORKDIR /build/services/sync
COPY services/sync/Cargo.toml services/sync/Cargo.lock* ./
COPY services/sync/src ./src
COPY contracts/journal-health ../../contracts/journal-health
RUN cargo build --release --bin orbita-sync --bin orbita-sync-tools

FROM debian:bookworm-slim
RUN groupadd -g 1000 orbita && useradd -u 1000 -g orbita -d /app -s /sbin/nologin orbita \
    && apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /build/services/sync/target/release/orbita-sync /usr/local/bin/orbita-sync
COPY --from=builder /build/services/sync/target/release/orbita-sync-tools /usr/local/bin/orbita-sync-tools
RUN mkdir -p /data/state /data/backup /etc/orbita-sync && chown -R orbita:orbita /data /app /etc/orbita-sync
USER orbita
WORKDIR /app
VOLUME ["/data/state", "/data/backup"]
ENV ORBITA_SYNC_STATE_DIR=/data/state
ENV ORBITA_SYNC_BACKUP_DIR=/data/backup
ENV ORBITA_SYNC_LISTEN_ADDR=127.0.0.1:8787
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8787/health/live || exit 1
ENTRYPOINT ["/usr/local/bin/orbita-sync"]
CMD ["serve"]
