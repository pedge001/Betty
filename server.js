'use strict';

/**
 * Betty — Hangar 24 Ops
 * Static host + lightweight first-party traffic logging.
 *
 * - Serves the prototype and the /admin dashboard (same files as before).
 * - POST /api/collect            logs one page view (no raw IP is stored).
 * - GET  /admin/api/traffic      returns aggregated stats for the dashboard.
 * - POST /admin/api/ignore-me    excludes this device's visits (so the owner
 *                                can see who else is using it).
 * - POST /admin/api/unignore-me  re-includes this device.
 * - GET  /admin/api/health       store status.
 *
 * Storage: Postgres when DATABASE_URL is set (Railway); otherwise an
 * in-memory store so it runs locally with no database (data resets on
 * restart). The aggregation runs in JS over recent rows for BOTH backends,
 * so behavior is identical whether or not a database is attached.
 */

const express = require('express');
const path = require('path');
const crypto = require('crypto');

// geoip-lite is optional: if it fails to load we simply skip city resolution
// rather than crash the server.
let geoip = null;
try { geoip = require('geoip-lite'); }
catch (e) { console.warn('[betty] geoip-lite unavailable — city resolution disabled:', e.message); }

const ROOT = __dirname;
const PORT = process.env.PORT || 3000;
const TZ = 'America/Los_Angeles';
const DAY = 86400000;

// ---------------------------------------------------------------------------
// Aggregation (shared by both stores)
// ---------------------------------------------------------------------------
function laDate(ts) {
  return new Date(ts).toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD
}
/** Human date + clock time in the brewery's local timezone. */
function laParts(ts) {
  const d = new Date(ts);
  return {
    date: d.toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric' }),
    time: d.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }),
    ymd: laDate(ts),
    iso: d.toISOString()
  };
}
/** The 10 most recent visitors, with page count and first/last activity. */
function recentVisitors(rows, n) {
  const sorted = rows.slice().sort((a, b) => a.ts - b.ts); // chronological
  const byVisitor = new Map();
  for (const r of sorted) {
    const key = r.visitor_id || ('anon|' + (r.city || '?') + '|' + (r.device || '?'));
    let e = byVisitor.get(key);
    if (!e) {
      e = { key, views: 0, firstTs: r.ts, lastTs: r.ts, city: r.city, region: r.region,
            country: r.country, device: r.device, source: r.source, screens: [] };
      byVisitor.set(key, e);
    }
    e.views++;
    e.lastTs = r.ts;
    if (r.city) { e.city = r.city; e.region = r.region; e.country = r.country; }
    if (r.device) e.device = r.device;
    if (r.source) e.source = r.source;
    const s = (r.screen && r.screen.trim()) ? r.screen : (r.path || '/');
    if (s && e.screens.indexOf(s) === -1) e.screens.push(s);
  }
  return [...byVisitor.values()]
    .sort((a, b) => b.lastTs - a.lastTs)
    .slice(0, n)
    .map(v => ({
      id: String(v.key).replace(/^anon\|/, '').slice(0, 6),
      anon: !v.key || String(v.key).startsWith('anon|'),
      city: v.city || null, region: v.region || null, country: v.country || null,
      device: v.device || null, source: v.source || null,
      views: v.views, screens: v.screens.slice(0, 8),
      first: laParts(v.firstTs), last: laParts(v.lastTs)
    }));
}
function last30Days() {
  const out = [];
  const now = Date.now();
  for (let i = 29; i >= 0; i--) out.push(laDate(now - i * DAY));
  return out;
}
function topN(rows, keyFn, n) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (k == null || k === '') continue;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([key, count]) => ({ key, count }));
}
function topCities(rows, n) {
  const m = new Map();
  for (const r of rows) {
    if (!r.city) continue;
    const k = r.city + '|' + (r.region || '') + '|' + (r.country || '');
    const e = m.get(k) || { city: r.city, region: r.region, country: r.country, count: 0 };
    e.count++;
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => b.count - a.count).slice(0, n);
}
function buildStats(rows60, ignoredSet, excludeSelf, storeKind) {
  const now = Date.now();
  const cutoff = now - 30 * DAY;
  const prevCut = now - 60 * DAY;
  let rows = rows60.filter(r => r.ts >= cutoff);
  let prev = rows60.filter(r => r.ts >= prevCut && r.ts < cutoff);
  if (excludeSelf) {
    const keep = r => !r.visitor_id || !ignoredSet.has(r.visitor_id);
    rows = rows.filter(keep);
    prev = prev.filter(keep);
  }
  const days = last30Days();
  const dayMap = new Map(days.map(d => [d, { count: 0, visitors: new Set() }]));
  for (const r of rows) {
    const e = dayMap.get(laDate(r.ts));
    if (e) { e.count++; if (r.visitor_id) e.visitors.add(r.visitor_id); }
  }
  const todayStr = days[days.length - 1];
  const distinct = (arr) => new Set(arr.filter(Boolean)).size;

  return {
    ok: true,
    store: storeKind,
    geo: !!geoip,
    generatedAt: new Date(now).toISOString(),
    rangeDays: 30,
    excludeSelf,
    ignoredCount: ignoredSet.size,
    totals: {
      pageViews: rows.length,
      visitors: distinct(rows.map(r => r.visitor_id)),
      viewsToday: rows.filter(r => laDate(r.ts) === todayStr).length,
      cities: distinct(rows.map(r => r.city)),
      activeDays: new Set(rows.map(r => laDate(r.ts))).size,
      pageViewsPrev: prev.length,
      visitorsPrev: distinct(prev.map(r => r.visitor_id))
    },
    daily: days.map(d => ({ date: d, count: dayMap.get(d).count, visitors: dayMap.get(d).visitors.size })),
    recent: recentVisitors(rows, 10),
    cities: topCities(rows, 12),
    pages: topN(rows, r => (r.screen && r.screen.trim()) ? r.screen : (r.path || '/'), 8),
    devices: topN(rows, r => r.device, 5),
    sources: topN(rows, r => r.source, 5),
    regions: topN(rows, r => r.region ? (r.region + (r.country && r.country !== 'US' ? ' · ' + r.country : '')) : null, 6)
  };
}

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------
function makeMemStore() {
  const rows = [];
  const ignored = new Set();
  return {
    kind: 'memory',
    async insert(v) { rows.push(Object.assign({ ts: Date.now() }, v)); },
    async recentRows() { const c = Date.now() - 60 * DAY; return rows.filter(r => r.ts >= c); },
    async ignoredSet() { return new Set(ignored); },
    async ignore(id) { ignored.add(id); },
    async unignore(id) { ignored.delete(id); },
    async isIgnored(id) { return ignored.has(id); },
    async ignoredCount() { return ignored.size; },
    async health() { return { ok: true, store: 'memory', totalRows: rows.length }; }
  };
}

function makePgStore(connectionString) {
  const { Pool } = require('pg');
  const sslNeeded = /sslmode=require/i.test(connectionString) || process.env.DATABASE_SSL === 'true';
  const pool = new Pool({
    connectionString,
    ssl: sslNeeded ? { rejectUnauthorized: false } : false,
    max: 5
  });
  const ready = (async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS page_views (
      id BIGSERIAL PRIMARY KEY,
      ts TIMESTAMPTZ NOT NULL DEFAULT now(),
      visitor_id TEXT,
      path TEXT,
      screen TEXT,
      referrer TEXT,
      device TEXT,
      source TEXT,
      city TEXT,
      region TEXT,
      country TEXT
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS page_views_ts_idx ON page_views (ts)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS ignored_visitors (
      visitor_id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  })();
  ready.catch(err => console.error('[betty] Postgres init failed:', err.message));
  return {
    kind: 'postgres',
    ready,
    async insert(v) {
      await ready;
      await pool.query(
        `INSERT INTO page_views (visitor_id, path, screen, referrer, device, source, city, region, country)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [v.visitor_id, v.path, v.screen, v.referrer, v.device, v.source, v.city, v.region, v.country]
      );
    },
    async recentRows() {
      await ready;
      const r = await pool.query(
        `SELECT visitor_id, ts, path, screen, device, source, city, region, country
         FROM page_views WHERE ts >= now() - interval '60 days'`
      );
      return r.rows.map(row => ({ ...row, ts: new Date(row.ts).getTime() }));
    },
    async ignoredSet() {
      await ready;
      const r = await pool.query(`SELECT visitor_id FROM ignored_visitors`);
      return new Set(r.rows.map(x => x.visitor_id));
    },
    async ignore(id) { await ready; await pool.query(`INSERT INTO ignored_visitors (visitor_id) VALUES ($1) ON CONFLICT DO NOTHING`, [id]); },
    async unignore(id) { await ready; await pool.query(`DELETE FROM ignored_visitors WHERE visitor_id=$1`, [id]); },
    async isIgnored(id) { await ready; const r = await pool.query(`SELECT 1 FROM ignored_visitors WHERE visitor_id=$1`, [id]); return r.rowCount > 0; },
    async ignoredCount() { await ready; const r = await pool.query(`SELECT count(*)::int c FROM ignored_visitors`); return r.rows[0].c; },
    async health() {
      try { await ready; const r = await pool.query(`SELECT count(*)::int c FROM page_views`); return { ok: true, store: 'postgres', totalRows: r.rows[0].c }; }
      catch (e) { return { ok: false, store: 'postgres', error: e.message }; }
    }
  };
}

const store = process.env.DATABASE_URL
  ? makePgStore(process.env.DATABASE_URL)
  : (console.warn('[betty] No DATABASE_URL — using in-memory store (resets on restart).'), makeMemStore());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function str(v, d) { return (typeof v === 'string' && v) ? v : (d || ''); }
function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  let ip = xff || (req.socket && req.socket.remoteAddress) || '';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return ip;
}
function deviceOf(ua) {
  ua = ua || '';
  if (/iPad|Tablet/i.test(ua)) return 'Tablet';
  if (/Mobi|Android|iPhone|iPod/i.test(ua)) return 'Mobile';
  return 'Desktop';
}
function sourceOf(ref, host) {
  if (!ref) return 'Direct';
  try { return (new URL(ref).host === host) ? 'Internal' : 'Referral'; }
  catch (e) { return 'Direct'; }
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '16kb' }));

// Parse cookies; assign a persistent visitor id (bv) if absent.
app.use((req, res, next) => {
  const jar = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > -1) jar[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  req.cookies = jar;
  if (!jar.bv) {
    const id = crypto.randomUUID();
    jar.bv = id;
    res.setHeader('Set-Cookie', `bv=${id}; Path=/; Max-Age=63072000; SameSite=Lax`);
  }
  next();
});

app.post('/api/collect', async (req, res) => {
  try {
    const b = req.body || {};
    const ip = clientIp(req);
    const geo = (geoip && ip) ? geoip.lookup(ip) : null;
    await store.insert({
      visitor_id: req.cookies.bv || null,
      path: str(b.path, '/').slice(0, 300),
      screen: str(b.screen, '').slice(0, 120),
      referrer: str(b.referrer, '').slice(0, 300),
      device: deviceOf(req.headers['user-agent']),
      source: sourceOf(b.referrer, req.headers.host),
      city: (geo && geo.city) || null,
      region: (geo && geo.region) || null,
      country: (geo && geo.country) || null
    });
  } catch (e) { /* never surface tracking errors to the client */ }
  res.status(204).end();
});

app.get('/admin/api/traffic', async (req, res) => {
  try {
    const excludeSelf = req.query.excludeSelf !== '0';
    const [rows, ignored] = await Promise.all([store.recentRows(), store.ignoredSet()]);
    const stats = buildStats(rows, ignored, excludeSelf, store.kind);
    stats.selfIgnored = req.cookies.bv ? ignored.has(req.cookies.bv) : false;
    res.json(stats);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/admin/api/ignore-me', async (req, res) => {
  try {
    const id = req.cookies.bv;
    if (!id) return res.json({ ok: false, error: 'no-visitor-id' });
    await store.ignore(id);
    res.json({ ok: true, selfIgnored: true, ignoredCount: await store.ignoredCount() });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/admin/api/unignore-me', async (req, res) => {
  try {
    const id = req.cookies.bv;
    if (id) await store.unignore(id);
    res.json({ ok: true, selfIgnored: false, ignoredCount: await store.ignoredCount() });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/admin/api/health', async (req, res) => {
  try { res.json(Object.assign({ geo: !!geoip }, await store.health())); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Serve the prototype at the root and at both the ".dc" and ".dc.html" forms.
// (Earlier static hosting issued clean-URL 301s that browsers cached, so
// requests can arrive for "/Hangar 24 Ops.dc" without the .html — handle both,
// and load the app directly at "/" so no redirect is needed at all.)
const APP_HTML = path.join(ROOT, 'Hangar 24 Ops.dc.html');
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  let p;
  try { p = decodeURIComponent(req.path); } catch (e) { p = req.path; }
  if (p === '/' || p === '/index.html' || p === '/Hangar 24 Ops.dc' || p === '/Hangar 24 Ops.dc.html') {
    return res.sendFile(APP_HTML);
  }
  next();
});

// Static files (support.js, /admin, etc.). API + app routes above take precedence.
app.use(express.static(ROOT, { extensions: ['html'] }));

// Only listen when run directly, so the aggregation helpers can be unit-tested.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[betty] listening on ${PORT} · store=${store.kind} · geo=${!!geoip}`);
  });
}

module.exports = { app, buildStats, recentVisitors, laParts, laDate };
