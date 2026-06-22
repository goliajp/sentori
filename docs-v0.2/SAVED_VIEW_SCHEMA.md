# Saved view payload schemas

> Each saved view stores a free-form `payload` (JSONB) — but for the
> Open → link to round-trip back to the dashboard with the filter
> restored, the payload has to match the shape the destination page
> reads from the URL.
>
> v0.2 status: only `issues` + `events` are wired end-to-end.
> `spans` / `replays` / `metrics` payloads can still be stored
> (free-form), but no UI restore yet — Open → falls through to the
> generic list page sans filter.

## issues

Destination: `/projects/:project_id/issues`

```json
{
  "status": "active"
}
```

- `status`: one of `"active"` / `"resolved"` / `"regressed"` /
  `"ignored"` / `"all"`. Default tab when missing or `"all"`.
- URL mapping: `status=active` → `?status=active`. `all` strips
  the param.

Future fields (planned, no UI yet):
- `release`: filter by release tag
- `environment`: filter by environment
- `assignee_user_id`: per-user view

## events

Destination: `/projects/:project_id/events`

```json
{
  "issue_id": "01934... (UUID)"
}
```

- `issue_id`: narrow to a single issue's event stream.
- URL mapping: `issue_id=<uuid>` → `?issue_id=<uuid>`.

Future fields:
- `release`: filter by release tag
- `kind`: `error` / `warning` / `info` / etc

## spans / replays / metrics

Payload accepted (server-side validation only checks JSON
shape), but the dashboard has no Open → restore yet. Recommended
shapes (forward-compat — start writing these into payloads now):

### spans

```json
{
  "trace_id": "...",
  "op": "http.client"
}
```

### replays

```json
{
  "release": "myapp@1.2.0",
  "user_id": "..."
}
```

### metrics

```json
{
  "name": "request.duration",
  "tags": { "endpoint": "/v1/events" }
}
```

## Round-trip example

```js
// Save current Issues filter
await api.createSavedView({
  name: "1.2 regressions",
  target: "issues",
  scope: "workspace",
  project_id: "<uuid>",
  payload: { status: "regressed" },
});

// Later, list views
const views = await api.listSavedViews("issues");
// → [{ id, name, target, project_id, payload, ... }]

// Open → restored URL
//   /projects/<uuid>/issues?status=regressed
```

## Why JSONB (not strict typed columns)

Each target has its own filter shape and they evolve at different
rates. JSONB lets us:
- Add a `release` filter to `issues` payloads without a migration
- Let third-party CLIs (sentori-cli) build payloads server-side
- Round-trip identical bytes through ETL (legacy → v0.2)

The cost is schema discipline — kept by this doc + the per-target
TypeScript helpers exposed by the dashboard's
`/webapp/src/lib/savedViewPayload.ts` (future).
