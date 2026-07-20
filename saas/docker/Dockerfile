# syntax=docker/dockerfile:1.7
#
# Sentori SaaS control plane — multi-stage rust → distroless cc.
# Build context = repo root.

FROM rust:1.97-slim-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
        pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src

COPY core/ /src/core/
COPY saas/ /src/saas/

WORKDIR /src/saas/server
RUN cargo build --release --bin sentori-saas-control

FROM gcr.io/distroless/cc-debian12:nonroot AS runtime

COPY --from=builder /src/saas/server/target/release/sentori-saas-control /usr/local/bin/sentori-saas-control

EXPOSE 9090
USER nonroot
ENTRYPOINT ["/usr/local/bin/sentori-saas-control"]
