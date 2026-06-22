# syntax=docker/dockerfile:1.7
#
# Sentori self-hosted server — multi-stage rust → distroless cc.
# Build context = repo root. Image goal: < 80 MB.
#
# Usage:
#   docker build -f self-hosted/docker/Dockerfile -t sentori-selfhosted:dev .

# ── builder ─────────────────────────────────────────────────
FROM rust:1.88-slim-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
        pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src

# Cache: copy core/ crate manifests first so cargo can pre-
# fetch deps without invalidating on every src edit.
COPY core/ /src/core/
COPY self-hosted/ /src/self-hosted/

WORKDIR /src/self-hosted/server
RUN cargo build --release --bin sentori-server

# ── runtime: distroless cc (libc + libgcc only) ─────────────
FROM gcr.io/distroless/cc-debian12:nonroot AS runtime

COPY --from=builder /src/self-hosted/server/target/release/sentori-server /usr/local/bin/sentori-server

EXPOSE 8080
USER nonroot
ENTRYPOINT ["/usr/local/bin/sentori-server"]
