# Betty — Hangar 24 Ops

Front-end prototype of **Betty**, the operations dashboard for Hangar 24. This build covers the **app shell** (navigation, notifications, sync status) and the **Executive Overview**, including the Prime Cost Command Center, labor, brewery production, and per-location views.

![Preview](preview.jpg)

> ⚠️ **Prototype only.** This is a front-end prototype with **hard-coded data** — there are no live integrations yet. It's intended for walking the team through the concept and UI. Real data connections (MarginEdge, Paylocity, etc.) and full functionality come next.

## Viewing it

The prototype is a single self-contained page. `support.js` pulls React and Babel from a CDN at runtime, so an internet connection is required.

1. Clone the repo.
2. Open `Hangar 24 Ops.dc.html` in a browser (or serve the folder, e.g. `python3 -m http.server`, and open the file).

`Hangar 24 Ops.dc.html` and `support.js` must stay in the same folder — the HTML loads the runtime via a relative path.

## Files

| File | Purpose |
|------|---------|
| `Hangar 24 Ops.dc.html` | The prototype (built with Claude Design). Markup, styles, and hard-coded data. |
| `support.js` | Claude Design runtime that renders the `<x-dc>` template. |
| `preview.jpg` | Screenshot used in this README. |

## Roadmap

- [ ] Wire up live data integrations (MarginEdge, Paylocity, POS)
- [ ] Replace hard-coded values with real metrics
- [ ] Build out remaining sections beyond the shell + Executive Overview
