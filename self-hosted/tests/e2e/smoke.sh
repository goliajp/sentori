#!/usr/bin/env bash
# self-hosted/tests/e2e/smoke.sh
#
# The shipped stack, from `docker compose up` to an event you can
# read back — against the real image, the real compose file and the
# real migrations.
#
#   bash self-hosted/tests/e2e/smoke.sh
#
# Requires docker compose v2, jq, curl.
#
# It asserts the things that have actually broken:
#
#   - the owner bootstrap prints a password you can log in with
#     (a generated password that never reaches the log is a locked
#     instance);
#   - an ingest token can post an event and gets a real issue back;
#   - **a resent event id is accepted rather than 500** — the case a
#     mobile client hits whenever a response is lost, which until
#     server 2.18.0 was a primary-key violation dressed as a server
#     fault, and which our own contract told the SDK to retry;
#   - a resend does not double-count the issue;
#   - a batch reports one outcome per event.
#
# There is no skip path. The previous version of this file exited 0
# with "empty project list — skipping ingest assertion", so the only
# thing it could ever prove was that healthz answered.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "${ROOT}/docker"

for cmd in docker jq curl; do
    command -v "$cmd" >/dev/null 2>&1 || { echo "missing required tool: $cmd" >&2; exit 1; }
done

PORT="${E2E_PORT:-18080}"
BASE="http://127.0.0.1:${PORT}"
export COMPOSE_PROJECT_NAME="sentori-e2e-$$"
ENV_FILE=".env.e2e.$$"
JAR="$(mktemp)"

cleanup() {
    docker compose --env-file "$ENV_FILE" down -v --remove-orphans >/dev/null 2>&1 || true
    rm -f "$ENV_FILE" "$JAR"
}
trap cleanup EXIT

cat > "$ENV_FILE" <<EOF
POSTGRES_PASSWORD=e2e-pass
SENTORI_OWNER_EMAIL=e2e@example.com
SENTORI_BASE_URL=${BASE}
SENTORI_PORT=${PORT}
RUST_LOG=warn
EOF

echo "→ up (${COMPOSE_PROJECT_NAME})"
docker compose --env-file "$ENV_FILE" up -d --build --quiet-pull

echo "→ waiting for healthz"
for i in $(seq 1 60); do
    if curl -fsS "${BASE}/healthz" 2>/dev/null | jq -e '.status == "ok"' >/dev/null 2>&1; then
        echo "  ready after ${i}s"
        break
    fi
    if [[ $i -eq 60 ]]; then
        echo "timeout waiting for healthz" >&2
        docker compose --env-file "$ENV_FILE" logs sentori | tail -50 >&2
        exit 1
    fi
    sleep 1
done

# The generated owner password is printed once, at boot. An operator
# who cannot find it has an instance nobody can log into.
# `|| true` because a `grep` that matches nothing is a non-zero exit,
# and under `set -e` that kills the script before the check below can
# say what went wrong — which is how this step failed silently once.
PASSWORD=""
for _ in $(seq 1 10); do
    PASSWORD="$(docker compose --env-file "$ENV_FILE" logs sentori 2>/dev/null \
        | tr -d '\r' | sed $'s/\033\[[0-9;]*m//g' \
        | grep -o 'password=[^ ]*' | head -1 | cut -d= -f2 || true)"
    [[ -n "$PASSWORD" ]] && break
    sleep 1
done
if [[ -z "$PASSWORD" ]]; then
    echo "no generated password in the boot log — an instance nobody can log into" >&2
    docker compose --env-file "$ENV_FILE" logs sentori | tail -30 >&2
    exit 1
fi

echo "→ sign in"
curl -fsS -c "$JAR" -X POST "${BASE}/auth/login" -H 'content-type: application/json' \
    -d "{\"email\":\"e2e@example.com\",\"password\":\"${PASSWORD}\"}" >/dev/null

echo "→ project + ingest token"
PROJECT_ID="$(curl -fsS -b "$JAR" -X POST "${BASE}/admin/api/projects" \
    -H 'content-type: application/json' \
    -d '{"name":"e2e","platform":"react-native"}' | jq -r '.id')"
[[ -n "$PROJECT_ID" && "$PROJECT_ID" != "null" ]] || { echo "no project id" >&2; exit 1; }

TOKEN="$(curl -fsS -b "$JAR" -X POST "${BASE}/admin/api/projects/${PROJECT_ID}/tokens" \
    -H 'content-type: application/json' \
    -d '{"name":"e2e-app","scope":"ingest"}' | jq -r '.token')"
[[ "$TOKEN" == st_* ]] || { echo "minted token does not look like st_… : $TOKEN" >&2; exit 1; }

EVENT_ID="019fe900-0000-7000-8000-0000000e2e01"
event_body() {
    cat <<EOF
{"id":"${EVENT_ID}","kind":"error","occurredAt":"2026-08-10T06:00:00Z",
 "platform":"javascript","release":"e2e@1.0.0+1","environment":"test",
 "payload":{"error":{"type":"TypeError","message":"x is undefined","stack":[]}}}
EOF
}

echo "→ ingest"
FIRST="$(curl -fsS -X POST "${BASE}/v1/events" -H "Authorization: Bearer ${TOKEN}" \
    -H 'content-type: application/json' -d "$(event_body)")"
ISSUE_ID="$(echo "$FIRST" | jq -r '.issueId')"
[[ "$(echo "$FIRST" | jq -r '.eventId')" == "$EVENT_ID" ]] \
    || { echo "server did not keep the client-minted id: $FIRST" >&2; exit 1; }
[[ -n "$ISSUE_ID" && "$ISSUE_ID" != "null" ]] || { echo "no issueId: $FIRST" >&2; exit 1; }
[[ "$(echo "$FIRST" | jq -r '.isNewIssue')" == "true" ]] \
    || { echo "expected isNewIssue=true on the first event: $FIRST" >&2; exit 1; }

echo "→ resend the same id (lost-response case)"
STATUS="$(curl -s -o /tmp/e2e-resend.$$ -w '%{http_code}' -X POST "${BASE}/v1/events" \
    -H "Authorization: Bearer ${TOKEN}" -H 'content-type: application/json' \
    -d "$(event_body)")"
SECOND="$(cat /tmp/e2e-resend.$$)"; rm -f /tmp/e2e-resend.$$
[[ "$STATUS" == "202" ]] \
    || { echo "resend returned ${STATUS}, want 202 — an SDK retries a 5xx forever: $SECOND" >&2; exit 1; }
[[ "$(echo "$SECOND" | jq -r '.isNewIssue')" == "false" ]] \
    || { echo "resend reported a new issue: $SECOND" >&2; exit 1; }
[[ "$(echo "$SECOND" | jq -r '.issueId')" == "$ISSUE_ID" ]] \
    || { echo "resend landed on a different issue: $SECOND" >&2; exit 1; }

echo "→ the resend did not count twice"
COUNT="$(curl -fsS -b "$JAR" "${BASE}/admin/api/issues?projectId=${PROJECT_ID}" \
    | jq -r --arg id "$ISSUE_ID" '.issues[] | select(.id == $id) | .eventCount')"
[[ "$COUNT" == "1" ]] || { echo "issue eventCount is ${COUNT}, want 1" >&2; exit 1; }

echo "→ batch"
BATCH="$(curl -fsS -X POST "${BASE}/v1/events:batch" -H "Authorization: Bearer ${TOKEN}" \
    -H 'content-type: application/json' -d '{"events":[
      {"kind":"warn","occurredAt":"2026-08-10T06:01:00Z","platform":"ios",
       "release":"e2e@1.0.0+1","environment":"test","name":"dead_button",
       "surface":{"screen":"Checkout","element":"PayButton"},"payload":{}},
      {"kind":"trace","occurredAt":"2026-08-10T06:01:01Z","platform":"ios",
       "release":"e2e@1.0.0+1","environment":"test","name":"app.launch","payload":{}}]}')"
[[ "$(echo "$BATCH" | jq -r '.accepted')" == "2" ]] \
    || { echo "batch accepted != 2: $BATCH" >&2; exit 1; }
[[ "$(echo "$BATCH" | jq -r '.outcomes | length')" == "2" ]] \
    || { echo "batch did not report one outcome per event: $BATCH" >&2; exit 1; }

# ── resolve → regression, the product's central mechanic ─────────
#
# "Fixed in release X" means only a recurrence in X or newer reopens
# the case. An older release still crashing is the build you already
# fixed, not a regression — and a fix that reopens on it teaches
# people to ignore the signal. There is a lot of machinery behind
# that sentence (release ordering, the anchor, the weak time
# fallback) and no test outside this file.
echo "→ two releases, oldest first"
for r in "reg@1.0.0+1" "reg@1.0.0+2"; do
    curl -fsS -X POST "${BASE}/v1/deploys" -H "Authorization: Bearer ${TOKEN}" \
        -H 'content-type: application/json' -d "{\"release\":\"${r}\"}" >/dev/null
    sleep 1   # created_at ordering is what the anchor compares
done

reg_event() {  # $1 = release
    cat <<EOF
{"kind":"error","occurredAt":"2026-08-10T06:02:00Z","platform":"ios",
 "release":"$1","environment":"test",
 "payload":{"error":{"type":"RangeError","message":"regression probe","stack":[]}}}
EOF
}

echo "→ first sighting in the newer release"
REG_ISSUE="$(curl -fsS -X POST "${BASE}/v1/events" -H "Authorization: Bearer ${TOKEN}" \
    -H 'content-type: application/json' -d "$(reg_event 'reg@1.0.0+2')" | jq -r '.issueId')"
[[ -n "$REG_ISSUE" && "$REG_ISSUE" != "null" ]] || { echo "no issue for the regression probe" >&2; exit 1; }

echo "→ resolve it, anchored to the newer release"
curl -fsS -b "$JAR" -X POST "${BASE}/admin/api/issues/${REG_ISSUE}/resolve" \
    -H 'content-type: application/json' -d '{"release":"reg@1.0.0+2"}' >/dev/null

echo "→ the OLDER release crashing must not reopen it"
OLD="$(curl -fsS -X POST "${BASE}/v1/events" -H "Authorization: Bearer ${TOKEN}" \
    -H 'content-type: application/json' -d "$(reg_event 'reg@1.0.0+1')")"
[[ "$(echo "$OLD" | jq -r '.regressed')" == "false" ]] \
    || { echo "an older release reopened a fix: $OLD" >&2; exit 1; }
STATUS_NOW="$(curl -fsS -b "$JAR" "${BASE}/admin/api/issues/${REG_ISSUE}" | jq -r '.status')"
[[ "$STATUS_NOW" == "resolved" ]] \
    || { echo "issue left ${STATUS_NOW} after an older-release event, want resolved" >&2; exit 1; }

echo "→ the anchored release crashing must reopen it"
NEW="$(curl -fsS -X POST "${BASE}/v1/events" -H "Authorization: Bearer ${TOKEN}" \
    -H 'content-type: application/json' -d "$(reg_event 'reg@1.0.0+2')")"
[[ "$(echo "$NEW" | jq -r '.regressed')" == "true" ]] \
    || { echo "the fixed release crashed again and nothing reopened: $NEW" >&2; exit 1; }
REOPENED="$(curl -fsS -b "$JAR" "${BASE}/admin/api/issues/${REG_ISSUE}" | jq -r '.status + " " + (.regressedInRelease // "-")')"
[[ "$REOPENED" == "open reg@1.0.0+2" ]] \
    || { echo "reopened state is '${REOPENED}', want 'open reg@1.0.0+2'" >&2; exit 1; }

echo "✓ e2e smoke passed — project ${PROJECT_ID}, issue ${ISSUE_ID}"
