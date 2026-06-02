#!/usr/bin/env bash
# Boot local Postgres 18 + Valkey 8 containers for sentori-server dev.
# Idempotent — safe to re-run.

set -euo pipefail

if ! docker ps -a --format '{{.Names}}' | grep -q '^sentori-pg$'; then
    echo "==> Starting sentori-pg (host port 55434)..."
    docker run -d --name sentori-pg -p 127.0.0.1:55434:5432 \
        -e POSTGRES_PASSWORD=dev \
        -e POSTGRES_DB=sentori \
        postgres:18-alpine >/dev/null
else
    docker start sentori-pg >/dev/null
fi

if ! docker ps -a --format '{{.Names}}' | grep -q '^sentori-vk$'; then
    echo "==> Starting sentori-vk (host port 56381)..."
    docker run -d --name sentori-vk -p 127.0.0.1:56381:6379 \
        valkey/valkey:8-alpine >/dev/null
else
    docker start sentori-vk >/dev/null
fi

echo "==> Waiting for postgres..."
for _ in $(seq 1 30); do
    if docker exec sentori-pg pg_isready -U postgres -d sentori >/dev/null 2>&1; then
        echo "    ready"
        break
    fi
    sleep 0.5
done

echo
echo "Set these in your shell or .env:"
echo "  DATABASE_URL=postgres://postgres:dev@127.0.0.1:55434/sentori"
echo "  VALKEY_URL=redis://127.0.0.1:56381"
