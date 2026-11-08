#!/usr/bin/env node
/**
 * R47 journeys — LAB server: the BUILT app (R47_DIST) and the REAL API entry (api/index.js: origin gate, CSRF double-submit, beta gate, capability gate,
 * rate limits, handlers) on one loopback origin, as scripts/lab-server.mjs serves it (the shipped vercel.json page headers, the record pages' initial HTML),
 * on R47_PORT (default 5192; never 3000). Nothing of the application's own API is mocked or stubbed.
 *
 * LAB-harness differences, all loopback only:
 *  - the API's development origin allowlist names :5173 only; a same-origin request of this server is presented to it with that development origin
 *    (as e2e-r46/pro/serve.mjs does) — every other origin is passed unchanged and refused by the gate;
 *  - the client address is the socket's, EXCEPT a client-supplied X-Forwarded-For inside the RFC 5737 documentation range 192.0.2.0/24: the journeys give
 *    each synthetic person their own address (each person on their own device), so the real per-address limits apply per person, never bypassed;
 *  - GET /__lab/outbox?to=<address> lists the in-memory test outbox (MAILER_PROVIDER=test only) for that exact address; /__lab/health.
 * Refuses to start outside a loopback LAB *_test database, with mock flags or a production profile.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = path.resolve(process.env.R47_DIST || path.join(ROOT, 'dist'));
const PORT = Number(process.env.R47_PORT || 5192);
const fail = (m) => { console.error(`refusing to start: ${m}`); process.exit(3); };
if (PORT === 3000) fail('port 3000 is the owner LAB');
if (process.env.USE_MOCKS || process.env.VITE_USE_MOCKS) fail('mock flags set');
if (process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production') fail('production profile');
const db = new URL(String(process.env.DATABASE_URL || 'postgres://x@invalid/x'));
if (!['127.0.0.1', 'localhost'].includes(db.hostname) || !/_test$/.test(db.pathname)) fail('LAB loopback *_test database only');
if (!fs.existsSync(path.join(DIST, 'index.html'))) fail(`no build in ${DIST}`);
process.chdir(ROOT);

const { default: api } = await import('../../api/index.js');
const pageHead = await import('../../api/_services/page-head.js');
const { db: pageDb } = await import('../../src/db/index.js');
const SHIPPED = (() => {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
    return (v.headers || []).filter((x) => x.source === '/(.*)').flatMap((x) => x.headers).filter((x) => x.key !== 'Strict-Transport-Security')
      .map((x) => [x.key, x.key === 'Content-Security-Policy' ? x.value.replace(/\s*upgrade-insecure-requests;?/g, '').trim() : x.value]);
  } catch { return []; }
})();
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain', '.xml': 'application/xml' };
const SELF = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);
const DOC_NET = /^192\.0\.2\.(\d{1,3})$/;

http.createServer(async (req, res) => {
  const u = new URL(String(req.url), `http://127.0.0.1:${PORT}`);
  /** @type {any} */ const r = req; /** @type {any} */ const s = res;
  r.query = Object.fromEntries(u.searchParams);
  if (u.pathname === '/__lab/health') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ lab: true, pid: process.pid })); }
  if (u.pathname === '/__lab/outbox') {
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
    const to = String(u.searchParams.get('to') || '').toLowerCase();
    if (process.env.MAILER_PROVIDER !== 'test' || !to) { res.statusCode = 404; return res.end('{}'); }
    // V2 / D1: sign-up, forgot-password and resend send their e-mail AFTER the answer — the outbox is read once that deferred work has finished
    await (await import('../../api/_utils/after-response.js')).settleAfterResponse();
    const { __getTestOutbox } = await import('../../api/_utils/mailer.js');
    const list = __getTestOutbox().filter((m) => String(Array.isArray(m.to) ? m.to.join(',') : m.to).toLowerCase().split(',').map((x) => x.trim()).includes(to));
    return res.end(JSON.stringify(list.map((m) => ({ subject: m.subject, text: m.text, category: m.category || null, attachments: (m.attachments || []).map((a) => a.filename || a.name || 'attachment') }))));
  }
  const fwd = String(req.headers['x-forwarded-for'] || '').trim();
  const m = DOC_NET.exec(fwd);
  req.headers['x-forwarded-for'] = m && Number(m[1]) <= 255 ? fwd : (req.socket?.remoteAddress || '127.0.0.1');
  if (SELF.has(String(req.headers.origin || ''))) req.headers.origin = 'http://127.0.0.1:5173';
  s.status = (/** @type {number} */ c) => { res.statusCode = c; return s; };
  s.json = (/** @type {any} */ d) => { if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(d)); return s; };
  s.send = (/** @type {any} */ d) => { res.end(typeof d === 'string' || Buffer.isBuffer(d) ? d : JSON.stringify(d)); return s; };
  try {
    if (u.pathname.startsWith('/api/') || u.pathname === '/api' || u.pathname === '/robots.txt' || u.pathname === '/sitemap.xml') {
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(req.method))) {
        const chunks = []; for await (const c of req) chunks.push(c);
        const raw = Buffer.concat(chunks).toString('utf8');
        try { r.body = raw ? JSON.parse(raw) : {}; } catch { r.body = {}; }
      }
      return await api(r, s);
    }
    for (const [k, v] of SHIPPED) res.setHeader(k, v);
    if (pageHead.recordPath(u.pathname) && (req.method === 'GET' || req.method === 'HEAD')) {
      const h = await pageHead.pageHead({ db: pageDb, pathname: u.pathname, origin: `http://127.0.0.1:${PORT}` });
      if (h.status === 301) { res.writeHead(301, { Location: h.location }); return res.end(); }
      res.writeHead(h.status, pageHead.pageHeaders(h));
      return res.end(req.method === 'HEAD' ? undefined : pageHead.renderPage(fs.readFileSync(path.join(DIST, 'index.html'), 'utf8'), h));
    }
    let f = path.join(DIST, decodeURIComponent(u.pathname));
    if (!f.startsWith(DIST)) { res.statusCode = 403; return res.end(); }
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      if (path.extname(u.pathname) !== '') { res.statusCode = 404; res.setHeader('Content-Type', 'text/plain'); return res.end('not found'); }
      f = path.join(DIST, 'index.html');
    }
    res.setHeader('Content-Type', TYPES[/** @type {keyof typeof TYPES} */ (path.extname(f))] || 'application/octet-stream');
    res.end(fs.readFileSync(f));
  } catch (e) {
    if (!res.headersSent) { res.statusCode = 500; res.setHeader('Content-Type', 'application/json'); res.end('{"error":"lab-server-error"}'); }
    console.error('[serve]', e instanceof Error ? `${e.name}: ${e.message}` : 'Error');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`R47 journeys LAB server http://127.0.0.1:${PORT}`));
