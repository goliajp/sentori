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

# ── symbolication, both directions ───────────────────────────────
#
# A stack the reader cannot read is the failure this product exists to
# prevent, and both halves of the path have broken in production: the
# resolver refused the source maps React Native actually produces, and
# a map uploaded after the crash rewrote nothing because no pass ever
# ran. Ad-hoc curl proved each fix once; this proves them every time.
echo "→ api-scope token"
API_TOKEN="$(curl -fsS -b "$JAR" -X POST "${BASE}/admin/api/projects/${PROJECT_ID}/tokens" \
    -H 'content-type: application/json' \
    -d '{"name":"e2e-ci","scope":"api"}' | jq -r '.token')"
[[ "$API_TOKEN" == st_* ]] || { echo "no api token: $API_TOKEN" >&2; exit 1; }

MAPDIR="$(mktemp -d)"
# One mapping: generated column 20 on line 1 → src/checkout.ts line 3,
# column 4. `oBAEI` is that segment in VLQ.
cat > "${MAPDIR}/index.android.bundle.map" <<'MAP'
{"version":3,"file":"index.android.bundle","sources":["src/checkout.ts"],
 "sourcesContent":["export function charge(userId) {\n  const token = mintToken(userId)\n  return post('/pay', { token })\n}\n"],
 "names":[],"mappings":"oBAEI"}
MAP

sym_event() {
    cat <<EOF
{"kind":"error","occurredAt":"2026-08-10T06:03:00Z","platform":"android",
 "release":"sym@1.0.0+1","environment":"test",
 "payload":{"error":{"type":"TypeError","message":"$1","stack":[
   {"file":"index.android.bundle","line":1,"column":20,"function":"e","inApp":true}]}}}
EOF
}

echo "→ a crash arrives before its map"
EARLY_ID="$(curl -fsS -X POST "${BASE}/v1/events" -H "Authorization: Bearer ${TOKEN}" \
    -H 'content-type: application/json' -d "$(sym_event 'before the map')" | jq -r '.eventId')"
EARLY_FILE="$(curl -fsS -b "$JAR" "${BASE}/admin/api/events/${EARLY_ID}" \
    | jq -r '.payload.error.stack[0].file')"
[[ "$EARLY_FILE" == "index.android.bundle" ]] \
    || { echo "expected the raw bundle path with no map on hand, got ${EARLY_FILE}" >&2; exit 1; }

echo "→ upload the map"
UPLOAD="$(curl -fsS -X POST "${BASE}/v1/releases/sym%401.0.0%2B1/artifacts" \
    -H "Authorization: Bearer ${API_TOKEN}" \
    -F kind=sourcemap -F "file=@${MAPDIR}/index.android.bundle.map")"
[[ "$(echo "$UPLOAD" | jq -r '.usable')" == "true" ]] \
    || { echo "the server could not parse a plain source map: $UPLOAD" >&2; exit 1; }

echo "→ retro pass rewrites the crash that predates it"
for i in $(seq 1 20); do
    LINE="$(curl -fsS -b "$JAR" "${BASE}/admin/api/events/${EARLY_ID}" \
        | jq -r '.payload.error.stack[0].contextLine // empty')"
    [[ -n "$LINE" ]] && break
    sleep 1
done
[[ "$LINE" == *"return post('/pay'"* ]] \
    || { echo "stored crash still unreadable after the upload: '${LINE}'" >&2; exit 1; }

echo "→ and the next crash resolves at ingest"
LATE_ID="$(curl -fsS -X POST "${BASE}/v1/events" -H "Authorization: Bearer ${TOKEN}" \
    -H 'content-type: application/json' -d "$(sym_event 'after the map')" | jq -r '.eventId')"
LATE_FILE="$(curl -fsS -b "$JAR" "${BASE}/admin/api/events/${LATE_ID}" \
    | jq -r '.payload.error.stack[0].file')"
[[ "$LATE_FILE" == "src/checkout.ts" ]] \
    || { echo "ingest-time symbolication did not run: ${LATE_FILE}" >&2; exit 1; }

echo "→ a bundle filed as a source map is refused a green light"
printf '\xc6\x1f\xbc\x03 not a map' > "${MAPDIR}/index.ios.bundle"
BAD="$(curl -fsS -X POST "${BASE}/v1/releases/sym%401.0.0%2B1/artifacts" \
    -H "Authorization: Bearer ${API_TOKEN}" \
    -F kind=sourcemap -F "file=@${MAPDIR}/index.ios.bundle")"
[[ "$(echo "$BAD" | jq -r '.usable')" == "false" ]] \
    || { echo "an unparseable artifact reported usable: $BAD" >&2; exit 1; }
KINDS="$(curl -fsS -H "Authorization: Bearer ${API_TOKEN}" \
    "${BASE}/v1/releases/sym%401.0.0%2B1/artifacts" | jq -r '.kinds.sourcemap')"
[[ "$KINDS" == "1" ]] \
    || { echo "sourcemap count is ${KINDS}, want 1 — the unreadable one must not count" >&2; exit 1; }
rm -rf "$MAPDIR"

# ── the /api surface an agent drives ─────────────────────────────
#
# `sentori-cli issue list|bundle|note|resolve` and the MCP server all
# run on an api-scope token against these four routes. Nothing else
# exercises them, and "the agent surface" is a claim worth being able
# to check.
echo "→ /api/issues"
API_LIST="$(curl -fsS -H "Authorization: Bearer ${API_TOKEN}" "${BASE}/api/issues")"
[[ "$(echo "$API_LIST" | jq -r '.issues | length')" -ge 1 ]] \
    || { echo "/api/issues returned nothing: $API_LIST" >&2; exit 1; }

echo "→ the ingest token must not reach it"
ING_STATUS="$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer ${TOKEN}" \
    "${BASE}/api/issues")"
[[ "$ING_STATUS" == "403" ]] \
    || { echo "an app-embedded ingest token read the triage API: ${ING_STATUS}" >&2; exit 1; }

echo "→ issue bundle (markdown + json)"
BUNDLE_MD="$(curl -fsS -H "Authorization: Bearer ${API_TOKEN}" \
    "${BASE}/api/issues/${ISSUE_ID}/bundle")"
[[ "$BUNDLE_MD" == *"x is undefined"* ]] \
    || { echo "the bundle does not carry the error message" >&2; exit 1; }
BUNDLE_JSON="$(curl -fsS -H "Authorization: Bearer ${API_TOKEN}" \
    "${BASE}/api/issues/${ISSUE_ID}/bundle?format=json")"
echo "$BUNDLE_JSON" | jq -e '.issue' >/dev/null \
    || { echo "json bundle has no issue object: $(echo "$BUNDLE_JSON" | head -c 200)" >&2; exit 1; }

echo "→ note + resolve over the api token"
curl -fsS -X POST -H "Authorization: Bearer ${API_TOKEN}" -H 'content-type: application/json' \
    -d '{"body":"handled by the e2e"}' "${BASE}/api/issues/${ISSUE_ID}/notes" >/dev/null
curl -fsS -X POST -H "Authorization: Bearer ${API_TOKEN}" -H 'content-type: application/json' \
    -d '{"release":"e2e@1.0.0+1"}' "${BASE}/api/issues/${ISSUE_ID}/resolve" >/dev/null
API_STATUS="$(curl -fsS -b "$JAR" "${BASE}/admin/api/issues/${ISSUE_ID}" | jq -r '.status')"
[[ "$API_STATUS" == "resolved" ]] \
    || { echo "resolve over the api token left the issue ${API_STATUS}" >&2; exit 1; }

# ── attachments: the evidence path ───────────────────────────────
#
# Replays, screenshots and view trees ride a separate request from the
# event on purpose — the event is small and must land, the evidence is
# large and may not. Nothing exercised that request, and it is how the
# minute before a crash reaches the dashboard.
echo "→ attach a replay to the event"
ATT_DIR="$(mktemp -d)"
printf '{"t":-2.0,"mediaType":"image/svg+xml","base64":"PHN2Zy8+"}\n' > "${ATT_DIR}/screens.ndjson"
ATT="$(curl -fsS -X POST "${BASE}/v1/events/${EVENT_ID}/attachments/screens" \
    -H "Authorization: Bearer ${TOKEN}" \
    -F "source=js" -F "file=@${ATT_DIR}/screens.ndjson;type=application/x-ndjson")"
REF="$(echo "$ATT" | jq -r '.refId')"
[[ -n "$REF" && "$REF" != "null" ]] || { echo "no refId from the attachment upload: $ATT" >&2; exit 1; }

echo "→ the dashboard can read it back byte for byte"
BACK="$(curl -fsS -b "$JAR" "${BASE}/admin/api/attachments/${REF}")"
[[ "$BACK" == *'"mediaType":"image/svg+xml"'* ]] \
    || { echo "attachment came back different: $(echo "$BACK" | head -c 120)" >&2; exit 1; }

echo "→ the event lists it"
LISTED="$(curl -fsS -b "$JAR" "${BASE}/admin/api/events/${EVENT_ID}" \
    | jq -r '.attachments[] | select(.kind == "screens") | .ref')"
[[ "$LISTED" == "$REF" ]] \
    || { echo "the event does not list the attachment it was given: '${LISTED}'" >&2; exit 1; }

echo "→ an unknown kind is refused"
BAD_KIND="$(curl -s -o /dev/null -w '%{http_code}' -X POST \
    "${BASE}/v1/events/${EVENT_ID}/attachments/definitely-not-a-kind" \
    -H "Authorization: Bearer ${TOKEN}" -F "file=@${ATT_DIR}/screens.ndjson")"
[[ "$BAD_KIND" == "400" ]] \
    || { echo "an unknown attachment kind returned ${BAD_KIND}, want 400 — the database CHECK would refuse it anyway" >&2; exit 1; }
rm -rf "$ATT_DIR"

echo "✓ e2e smoke passed — project ${PROJECT_ID}, issue ${ISSUE_ID}"
