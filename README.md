# Betty — Hangar 24 Ops

Front-end prototype of **Betty**, the operations dashboard for Hangar 24. This build covers the **app shell** (navigation, notifications, sync status) and the **Executive Overview**, including the Prime Cost Command Center, labor, brewery production, and per-location views.

![Preview](preview.jpg)

> ⚠️ **Prototype only.** This is a front-end prototype with **hard-coded data** — there are no live integrations yet. It's intended for walking the team through the concept and UI. Real data connections (MarginEdge, Paylocity, etc.) and full functionality come next.

## Viewing it

The prototype is a single self-contained page. `support.js` pulls React and Babel from a CDN at runtime, so an internet connection is required.

1. Clone the repo.
2. Open `Hangar 24 Ops.dc.html` in a browser (or serve the folder, e.g. `python3 -m http.server`, and open the file).

`Hangar 24 Ops.dc.html` and `support.js` must stay in the same folder — the HTML loads the runtime via a relative path.

## Deploying (Railway / any Node host)

The app now runs a small **Node/Express server** (`server.js`) that serves the
prototype *and* logs traffic.

- `npm install` — installs `express`, `pg`, and `geoip-lite`.
- `npm start` — runs `node server.js`, listening on `$PORT` (Railway sets this; defaults to `3000` locally).
- The server serves the prototype at `/`, the dashboard at `/admin`, and the tracking API.

### Database (traffic logging)

Set **`DATABASE_URL`** and traffic is stored in Postgres (tables are created
automatically on boot). On Railway, add a reference variable on the app service:

```
DATABASE_URL = ${{ Postgres.DATABASE_URL }}
```

Without `DATABASE_URL` the server falls back to an **in-memory store** (still fully
functional, but data resets on restart). The `/admin` page shows which mode is
active ("Live traffic" vs "No DB attached"). If your connection string requires
SSL, set `DATABASE_SSL=true`.

## Files

| File | Purpose |
|------|---------|
| `server.js` | Express server: serves the app + first-party traffic logging (Postgres or in-memory). |
| `Hangar 24 Ops.dc.html` | The prototype (built with Claude Design). Includes a small view-tracking beacon. |
| `support.js` | Claude Design runtime that renders the `<x-dc>` template. |
| `index.html` | Root redirect to the prototype (so `/` loads it when deployed). |
| `admin/index.html` | Live traffic dashboard at **`/admin`** — intentionally unlinked; reach it by typing the URL. |
| `package.json` | Server + dependencies. |
| `preview.jpg` | Screenshot used in this README. |

## Admin traffic page (`/admin`)

A standalone dashboard at `/admin` shows **real** first-party traffic: page-view
KPIs, a 30-day trend, **visitors by city**, top pages, and device/source/region
splits. It is **not linked anywhere in the app** — only reachable by typing the URL.

- **Logging.** Each screen view POSTs to `/api/collect`. The server resolves the
  visitor's city/region from their IP via offline geo-IP (`geoip-lite`) and stores
  it — **raw IP addresses are not stored**. A `bv` cookie identifies returning
  visitors (no personal data).
- **Ignoring your own traffic.** Click **"Ignore my visits from this device"** on
  `/admin` (do this on each browser/device you use). That device's `bv` is added to
  an ignore list and dropped from all figures, so you see who *else* is using it.
  Toggle **"Include my visits"** to see everything again.
- **Not password-protected** yet — anyone with the URL can view it. Fine for a
  prototype; add auth before it holds anything sensitive.

### Endpoints

| Route | Purpose |
|-------|---------|
| `POST /api/collect` | Log one page view (called by the app). |
| `GET /admin/api/traffic?excludeSelf=1` | Aggregated stats for the dashboard. |
| `POST /admin/api/ignore-me` / `unignore-me` | Exclude / re-include this device. |
| `GET /admin/api/health` | Store status + row count. |

## Roadmap

- [x] First-party traffic logging with per-city breakdown + self-exclusion
- [ ] Password-protect `/admin`
- [ ] Wire up live data integrations (MarginEdge, Paylocity, POS)
- [ ] Replace hard-coded values with real metrics
- [ ] Build out remaining sections beyond the shell + Executive Overview
