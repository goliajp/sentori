#!/usr/bin/env bash
# The Swift SDK against a real Sentori server.
#
# Every other iOS test asserts the shape this SDK *builds*. That is
# worth nothing if the server rejects it, and a mock would agree with
# whatever mistake the SDK is making — which is how a wire format
# quietly diverges. The one thing that cannot agree with a mistake is
# the server.
#
#   bash scripts/ios-live-ingest.sh
#
# Brings up Postgres (Docker if present, Homebrew otherwise), builds
# and starts the server, mints a project and an ingest token, points
# the live XCTest at it, and — the part that matters — **fails if that
# test skipped**. `XCTSkip` reports TEST SUCCEEDED, so a job that only
# checks the exit code would go green for years without ever having
# sent a byte.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PORT="${SENTORI_LIVE_PORT:-8392}"
PGPORT="${SENTORI_LIVE_PGPORT:-55433}"
BASE="http://127.0.0.1:${PORT}"
FIXTURE="sdk/native/fixtures/live-server.json"
LOG="$(mktemp)"
SERVER_PID=""

STARTED_BREW_PG=""

cleanup() {
    [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
    docker rm -f sentori-live-pg >/dev/null 2>&1 || true
    # `brew services start` also registers the service to run at
    # login. On a CI runner that is free; on someone's laptop it is a
    # background daemon they did not ask for, so put it back.
    [ -n "$STARTED_BREW_PG" ] && brew services stop "$STARTED_BREW_PG" >/dev/null 2>&1 || true
    rm -f "$FIXTURE"
}
trap cleanup EXIT

echo "→ postgres"
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    docker rm -f sentori-live-pg >/dev/null 2>&1 || true
    docker run -d --name sentori-live-pg \
        -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=sentori \
        -p "${PGPORT}:5432" postgres:18-alpine >/dev/null
    for _ in $(seq 1 60); do
        docker exec sentori-live-pg pg_isready -U postgres >/dev/null 2>&1 && break
        sleep 1
    done
    DB="postgres://postgres:dev@127.0.0.1:${PGPORT}/sentori"
else
    # macOS runners have no Docker, and no Postgres either — the image
    # ships neither. Homebrew's trusts the local user on 5432, which
    # is enough for a database that lives for one test run.
    #
    # Nothing here is silenced. The first version sent brew's output
    # to /dev/null and failed four seconds in with `exit code 1` and
    # no reason, which is the same defect this script exists to stop
    # other gates from having.
    FORMULA=""
    for candidate in postgresql@18 postgresql@17 postgresql; do
        if brew list --formula "$candidate" >/dev/null 2>&1; then FORMULA="$candidate"; break; fi
    done
    if [ -z "$FORMULA" ]; then
        echo "  installing postgresql@17"
        brew install postgresql@17
        FORMULA=postgresql@17
    fi
    echo "  starting $FORMULA"
    brew services start "$FORMULA"
    STARTED_BREW_PG="$FORMULA"
    # `brew services` returns before the socket is up.
    READY=""
    for _ in $(seq 1 60); do
        if pg_isready -q -h 127.0.0.1 -p 5432; then READY=1; break; fi
        sleep 1
    done
    if [ -z "$READY" ]; then
        echo "postgres never accepted connections; brew services says:" >&2
        brew services list >&2
        exit 1
    fi
    dropdb --if-exists -h 127.0.0.1 sentori_live || true
    createdb -h 127.0.0.1 sentori_live
    DB="postgres://$(whoami)@127.0.0.1:5432/sentori_live"
fi

echo "→ server"
(cd self-hosted/server && cargo build --quiet)
SENTORI_BIND="127.0.0.1:${PORT}" \
SENTORI_DATABASE_URL="$DB" \
SENTORI_OWNER_EMAIL=live@example.com \
SENTORI_OWNER_PASSWORD=live-password-long-enough \
SENTORI_BASE_URL="$BASE" \
    self-hosted/server/target/debug/sentori-server >"$LOG" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 60); do curl -fsS "${BASE}/healthz" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS "${BASE}/healthz" >/dev/null || { echo "server never came up:"; cat "$LOG"; exit 1; }

echo "→ project + ingest token"
JAR="$(mktemp)"
curl -fsS -c "$JAR" -X POST "${BASE}/auth/login" -H 'content-type: application/json' \
    -d '{"email":"live@example.com","password":"live-password-long-enough"}' >/dev/null
PROJECT="$(curl -fsS -b "$JAR" -X POST "${BASE}/admin/api/projects" \
    -H 'content-type: application/json' -d '{"name":"swift-live","platform":"ios"}' \
    | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')"
TOKEN="$(curl -fsS -b "$JAR" -X POST "${BASE}/admin/api/projects/${PROJECT}/tokens" \
    -H 'content-type: application/json' -d '{"name":"live","scope":"ingest"}' \
    | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')"

python3 - "$BASE" "$TOKEN" "$FIXTURE" <<'PY'
import json, sys
base, token, out = sys.argv[1], sys.argv[2], sys.argv[3]
open(out, 'w').write(json.dumps({"base": base, "token": token}) + "\n")
PY

echo "→ xctest against it"
XCLOG="$(mktemp)"
DEST="${SENTORI_LIVE_DESTINATION:-platform=iOS Simulator,name=iPhone 17 Pro}"
( cd sdk/native/ios && xcodebuild test -scheme Sentori -destination "$DEST" \
    -only-testing:SentoriTests/SentoriLiveServerTests ) >"$XCLOG" 2>&1 || {
    grep -E "error: -\[|XCTAssert" "$XCLOG" | head -20
    echo "FAIL: the live suite did not pass" >&2
    exit 1
}

# The whole point. `XCTSkip` is reported as a pass, so without this a
# missing fixture, a renamed test or a simulator that never launched
# all read as success.
if grep -q "skipped" "$XCLOG"; then
    grep -E "skipped" "$XCLOG" | head -3
    echo "FAIL: the live test skipped — it proved nothing" >&2
    exit 1
fi
grep -E "Executed [0-9]+ test" "$XCLOG" | tail -1

echo "→ and the events are readable back"
python3 - "$BASE" "$JAR" "$PROJECT" <<'PY'
import json, subprocess, sys
base, jar, project = sys.argv[1], sys.argv[2], sys.argv[3]

def get(path):
    out = subprocess.run(["curl", "-fsS", "-b", jar, f"{base}{path}"],
                         capture_output=True, text=True, check=True).stdout
    return json.loads(out)

issues = get(f"/admin/api/issues?projectId={project}&limit=20")["issues"]
kinds = sorted(i["kind"] for i in issues)
want = ["assert", "error", "probe", "warn"]
if kinds != want:
    sys.exit(f"FAIL: server stored {kinds}, want {want}")

err = next(i for i in issues if i["kind"] == "error")
events = get(f"/admin/api/issues/{err['id']}/events?limit=1")
ev = get(f"/admin/api/events/{events[list(events)[0]][0]['id']}")
p = ev["payload"]

# Each of these is a field the Swift assembles by hand, and each has
# its own way of being silently absent.
checks = {
    "userKey": bool(ev.get("userKey")),
    "platform=ios": ev.get("platform") == "ios",
    "error.domain": (p.get("error") or {}).get("domain") == "SwiftE2E",
    "data": (p.get("data") or {}).get("cartId") == "c_1",
    "context": (p.get("context") or {}).get("tenant") == "acme",
    "signals": bool(p.get("signals")),
    "device.os": (p.get("device") or {}).get("os") == "ios",
}
bad = [k for k, ok in checks.items() if not ok]
if bad:
    sys.exit(f"FAIL: missing or wrong on the stored event: {bad}\n{json.dumps(ev, indent=2)[:900]}")
print("      " + " · ".join(checks))
PY

echo "✓ the server accepts what the Swift SDK sends"
