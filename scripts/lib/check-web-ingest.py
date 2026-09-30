"""What the server got from a real browser, and what the page paid.

Called by scripts/web-live-ingest.sh.
"""

import json
import subprocess
import sys

base, jar, project, out_file = sys.argv[1:5]

# A frame at 60 Hz is 16.7 ms and the project's own red line is 5 ms
# of main thread per tick. `longtask` entries are the browser's own
# definition of "this blocked the page", and the SDK doing 550 calls
# must not produce one.
LONG_TASK_BUDGET_MS = 50


def get(path):
    out = subprocess.run(
        ["curl", "-fsS", "-b", jar, f"{base}{path}"], capture_output=True, text=True
    ).stdout
    return json.loads(out or "{}")


issues = get(f"/admin/api/issues?projectId={project}&limit=50").get("issues") or []
if not issues:
    sys.exit("✗ a page that threw twice and clicked once produced no issues")

titles = [i.get("title") or "" for i in issues]


def want(fragment, why):
    if not any(fragment in t for t in titles):
        sys.exit(f"✗ no issue titled like {fragment!r} — {why}.\n  got: {titles}")


want("TypeError", "an uncaught error thrown from a timeout did not arrive")
want("RangeError", "an unhandled promise rejection did not arrive")

# The breadcrumbs. They are the reason to have a ring at all, and they
# are also the thing most likely to leak: a click breadcrumb that
# carries the button's text ships whatever the button said.
detail = None
for issue in issues:
    if "TypeError" not in (issue.get("title") or ""):
        continue
    events = (get(f'/admin/api/issues/{issue["id"]}/events') or {}).get("events") or []
    if events:
        detail = get(f'/admin/api/events/{events[0]["id"]}')
    break

if detail is None:
    sys.exit("✗ the uncaught TypeError has no stored event behind it")

payload = detail.get("payload") or {}
signals = payload.get("signals") or []
kinds = {s.get("kind") for s in signals}
if "click" not in kinds:
    sys.exit(f"✗ the click never reached the signal ring; kinds present: {sorted(kinds)}")
if "nav" not in kinds:
    sys.exit(
        "✗ a history.pushState navigation is missing from the ring — a single-page "
        f"app's navigations would be invisible; kinds present: {sorted(kinds)}"
    )

blob = json.dumps(signals)
for leaked in ("Dora Cawley", "412.00"):
    if leaked in blob:
        sys.exit(
            f"✗ {leaked!r} travelled in a breadcrumb — the button's label is user "
            "content, and a breadcrumb is context, not a reason to ship it"
        )

if not detail.get("userKey"):
    sys.exit("✗ the event arrived with no userKey, so breadth cannot be counted")
if (payload.get("device") or {}).get("os") in (None, ""):
    sys.exit("✗ no device was recorded")

long_tasks = json.load(open(out_file)).get("longTasks") or []
over = [d for d in long_tasks if d > LONG_TASK_BUDGET_MS]
if over:
    sys.exit(
        f"✗ the SDK blocked the main thread for {over} ms (budget {LONG_TASK_BUDGET_MS} ms). "
        "A reporter that costs the page a frame is one the host removes."
    )

print(
    f"✓ a real browser: {len(issues)} issues, breadcrumbs without the label's text, "
    f"{len(long_tasks)} long task(s), none over {LONG_TASK_BUDGET_MS} ms"
)
