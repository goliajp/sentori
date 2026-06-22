#!/usr/bin/env bash
# saas/tests/e2e/smoke.sh
#
# End-to-end smoke test for the SaaS control-plane stack:
#   1. docker compose up -d (control-plane pg + saas binary)
#   2. wait for /healthz
#   3. POST /v1/saas/tenants to provision a tenant
#   4. Assert the tenant row exists + the tenant DB was
#      created
#   5. clean teardown
#
# Usage: bash saas/tests/e2e/smoke.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
COMPOSE_DIR="${ROOT}/docker"
cd "$COMPOSE_DIR"

for cmd in docker jq curl; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "❌ missing required tool: $cmd" >&2
        exit 1
    fi
done

export COMPOSE_PROJECT_NAME="sentori-saas-e2e-$$"

cleanup() {
    echo "🧹 cleaning up ${COMPOSE_PROJECT_NAME}"
    docker compose down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "🚀 bringing up saas stack (${COMPOSE_PROJECT_NAME})"
cat > .env.e2e <<EOF
POSTGRES_USER=sentori_saas
POSTGRES_PASSWORD=e2e-pass
POSTGRES_DB=sentori_saas
POSTGRES_PORT=15433
SENTORI_SAAS_PORT=19090
SENTORI_STRIPE_WEBHOOK_SECRET=
RUST_LOG=warn
EOF
docker compose --env-file .env.e2e up -d --build --quiet-pull
rm .env.e2e

echo "⏳ waiting for healthz"
for i in $(seq 1 30); do
    if curl -fsS http://localhost:19090/healthz 2>/dev/null | jq -e '.status == "ok"' >/dev/null 2>&1; then
        echo "✅ ready (after ${i}s)"
        break
    fi
    if [[ $i -eq 30 ]]; then
        echo "❌ timeout waiting for healthz" >&2
        docker compose logs saas | tail -50 >&2
        exit 1
    fi
    sleep 1
done

echo "📡 listing tenants (should be empty on fresh stack)"
INITIAL="$(curl -fsS http://localhost:19090/v1/saas/tenants)"
echo "$INITIAL" | jq .
if [[ "$(echo "$INITIAL" | jq -r 'length')" != "0" ]]; then
    echo "❌ expected empty tenant list on fresh stack" >&2
    exit 1
fi

echo "🏗️ creating tenant"
CREATE_RESPONSE="$(curl -fsS -X POST http://localhost:19090/v1/saas/tenants \
    -H 'content-type: application/json' \
    -d '{
        "slug": "acme",
        "display_name": "Acme Corp",
        "owner_email": "owner@acme.example"
    }')"
echo "$CREATE_RESPONSE" | jq .

TENANT_ID="$(echo "$CREATE_RESPONSE" | jq -r '.id')"
DB_NAME="$(echo "$CREATE_RESPONSE" | jq -r '.db_name')"
STATUS="$(echo "$CREATE_RESPONSE" | jq -r '.status')"

if [[ -z "$TENANT_ID" || "$TENANT_ID" == "null" ]]; then
    echo "❌ tenant id missing in response" >&2
    exit 1
fi
if [[ "$DB_NAME" != "sentori_t_acme" ]]; then
    echo "❌ unexpected db_name: $DB_NAME (expected sentori_t_acme)" >&2
    exit 1
fi
if [[ "$STATUS" != "provisioning" ]]; then
    echo "❌ expected status=provisioning on create; got $STATUS" >&2
    exit 1
fi

echo "🔍 verifying tenant DB was created"
docker compose exec -T postgres psql -U sentori_saas -d postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'" | grep -q 1 || {
    echo "❌ tenant DB '${DB_NAME}' was not created" >&2
    exit 1
}

echo "📋 verifying tenant in list"
LISTED="$(curl -fsS http://localhost:19090/v1/saas/tenants)"
if [[ "$(echo "$LISTED" | jq -r 'length')" != "1" ]]; then
    echo "❌ expected exactly 1 tenant in list" >&2
    exit 1
fi

echo "✅ saas e2e smoke test PASSED"
echo "    tenant_id: $TENANT_ID"
echo "    db_name:   $DB_NAME"
echo "    status:    $STATUS"
